/**
 * Course Routes
 * 
 * Handles course catalog operations including:
 * - Listing courses with filters
 * - Course details
 * - Search with vector similarity
 * - Enrollment management
 * - Course completion tracking
 * 
 * Why: Courses are the primary learning resources. These routes provide
 * access to the course catalog and manage user enrollments.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * Validation schemas
 */
const courseFilterSchema = z.object({
  source: z.enum(['iGOT', 'NSSTA_TPAC', 'MoSPI_Internal']).optional(),
  domain: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  page_size: z.coerce.number().min(1).max(50).default(20),
  is_tpac_classroom: z.coerce.boolean().optional(),
});

/**
 * GET /api/courses
 * 
 * Returns paginated list of courses with optional filters.
 * 
 * Why: Main endpoint for course browsing and discovery.
 */
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    source,
    domain,
    search,
    page = 1,
    page_size = 20,
    is_tpac_classroom,
  } = courseFilterSchema.parse(req.query);

  // Build query
  let query = supabaseAdmin
    .from('courses')
    .select(`
      *,
      competency_domain:competency_domains(name)
    `, { count: 'exact' });

  // Apply filters
  if (source) {
    query = query.eq('source', source);
  }
  if (is_tpac_classroom !== undefined) {
    query = query.eq('is_tpac_classroom', is_tpac_classroom);
  }
  if (domain) {
    // Filter by domain name (requires join)
    query = query.contains('target_competencies', [domain]);
  }
  if (search) {
    // Text search on title and description
    query = query.ilike('title', `%${search}%`);
  }

  // Pagination
  const from = (page - 1) * page_size;
  const to = from + page_size - 1;
  query = query.range(from, to).order('created_at', { ascending: false });

  // Execute query
  try {
    const { data: courses, error, count } = await query;
    if (error) {
      console.error('Course fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch courses',
        code: 'FETCH_FAILED',
        detail: error.message || error,
      });
      return;
    }

    res.json({
      success: true,
      data: courses || [],
      pagination: {
        total: count || 0,
        page,
        page_size,
        total_pages: Math.ceil((count || 0) / page_size),
      },
    });
  } catch (err: any) {
    console.error('Unexpected course fetch exception:', err && err.stack ? err.stack : err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch courses',
      code: 'FETCH_EXCEPTION',
      detail: String(err?.message || err),
    });
  }
}));

/**
 * GET /api/courses/enrolled
 * 
 * Returns courses the user is enrolled in.
 * Must be before /:id to avoid shadowing.
 */
router.get('/enrolled', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: enrollments, error } = await supabaseAdmin
    .from('course_enrollments')
    .select('*, course:courses(*)')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });

  if (error) {
    console.error('Enrollment fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch enrollments',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: enrollments || [],
  });
}));

/**
 * GET /api/courses/recommended
 * 
 * Returns personalized course recommendations based on skill gaps.
 */
router.get('/recommended', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { limit = 10 } = req.query;

  const { data: gaps } = await supabaseAdmin
    .from('user_competency_scores')
    .select(`
      *,
      competency:competencies(
        id,
        name,
        domain_id,
        domain:competency_domains(name)
      )
    `)
    .eq('user_id', userId)
    .order('gap_score', { ascending: false })
    .limit(10);

  if (!gaps || gaps.length === 0) {
    res.json({
      success: true,
      data: [],
      message: 'No skill gaps found. Complete onboarding first.',
    });
    return;
  }

  const highGapCompetencies = gaps.filter((g) => g.gap_score >= 2.0).map((g) => g.competency_id);
  const mediumGapCompetencies = gaps.filter((g) => g.gap_score >= 1.0 && g.gap_score < 2.0).map((g) => g.competency_id);

  let recommendedCourses: Record<string, unknown>[] = [];

  if (highGapCompetencies.length > 0) {
    const { data: courses } = await supabaseAdmin
      .from('courses')
      .select('*')
      .contains('target_competencies', highGapCompetencies)
      .order('duration_hours', { ascending: true })
      .limit(Number(limit));

    if (courses) {
      recommendedCourses = courses.map((course) => ({
        ...course,
        priority: 'high' as const,
        matching_gap: 'High priority skill gap',
      }));
    }
  }

  if (recommendedCourses.length < Number(limit) && mediumGapCompetencies.length > 0) {
    const { data: courses } = await supabaseAdmin
      .from('courses')
      .select('*')
      .contains('target_competencies', mediumGapCompetencies)
      .not('id', 'in', recommendedCourses.map((c) => c.id))
      .order('duration_hours', { ascending: true })
      .limit(Number(limit) - recommendedCourses.length);

    if (courses) {
      recommendedCourses.push(
        ...courses.map((course) => ({
          ...course,
          priority: 'medium' as const,
          matching_gap: 'Medium priority skill gap',
        }))
      );
    }
  }

  res.json({
    success: true,
    data: recommendedCourses,
    skill_gaps_analyzed: gaps.length,
  });
}));

/**
 * GET /api/courses/search/similar
 * 
 * Searches for similar courses using vector similarity.
 */
router.get('/search/similar', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { competency_id, limit = 5 } = req.query;

  if (!competency_id) {
    res.status(400).json({
      success: false,
      error: 'competency_id is required',
      code: 'MISSING_PARAM',
    });
    return;
  }

  const { data: competency } = await supabaseAdmin
    .from('competencies')
    .select('embedding')
    .eq('id', competency_id)
    .single();

  if (!competency?.embedding) {
    res.status(400).json({
      success: false,
      error: 'Competency embedding not found',
      code: 'NO_EMBEDDING',
    });
    return;
  }

  const { data: courses, error } = await supabaseAdmin.rpc('match_courses', {
    query_embedding: competency.embedding,
    match_threshold: 0.7,
    match_count: Number(limit),
  });

  if (error) {
    console.error('Course search error:', error);
    const { data: fallbackCourses } = await supabaseAdmin
      .from('courses')
      .select('*')
      .contains('target_competencies', [competency_id])
      .limit(Number(limit));

    res.json({
      success: true,
      data: fallbackCourses || [],
      message: 'Using fallback search',
    });
    return;
  }

  res.json({
    success: true,
    data: courses || [],
  });
}));

/**
 * GET /api/courses/tpac/calendar
 * 
 * Returns upcoming TPAC classroom sessions.
 */
router.get('/tpac/calendar', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { limit = 20 } = req.query;

  const { data: sessions, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('is_tpac_classroom', true)
    .gte('tpac_start_date', new Date().toISOString())
    .order('tpac_start_date', { ascending: true })
    .limit(Number(limit));

  if (error) {
    console.error('TPAC calendar error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch TPAC calendar',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: sessions || [],
  });
}));

/**
 * GET /api/courses/:id
 * 
 * Returns detailed course information.
 * Must be AFTER specific routes (/enrolled, /recommended, etc.) to avoid shadowing.
 */
router.get('/:id', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const { data: course, error } = await supabaseAdmin
    .from('courses')
    .select(`
      *,
      competency_domain:competency_domains(name)
    `)
    .eq('id', id)
    .single();

  if (error || !course) {
    throw new NotFoundError('Course');
  }

  if (course.target_competencies && course.target_competencies.length > 0) {
    const { data: competencies } = await supabaseAdmin
      .from('competencies')
      .select('id, name, domain_id, domain:competency_domains(name)')
      .in('id', course.target_competencies);

    (course as Record<string, unknown>).target_competency_details = competencies;
  }

  res.json({
    success: true,
    data: course,
  });
}));

/**
 * POST /api/courses/:id/enroll
 * 
 * Enrolls the user in a course.
 * 
 * Why: Records user enrollment for progress tracking.
 */
router.post('/:id/enroll', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id: courseId } = req.params;
  const userId = req.user!.id;

  // Check if course exists
  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('id, title')
    .eq('id', courseId)
    .single();

  if (!course) {
    throw new NotFoundError('Course');
  }

  // Create enrollment record in course_enrollments
  const now = new Date();
  const expected = new Date(now.getTime() + (course.duration_hours || 10) * 60 * 60 * 1000);
  const { data: enrollment, error } = await supabaseAdmin
    .from('course_enrollments')
    .upsert({
      user_id: userId,
      course_id: courseId,
      source: course.source || 'iGOT',
      status: 'in_progress',
      progress_percentage: 0,
      started_at: now.toISOString(),
      expected_completion_at: expected.toISOString(),
    }, { onConflict: 'user_id,course_id' })
    .select('*, course:courses(*)')
    .single();

  if (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to enroll in course',
      code: 'ENROLLMENT_FAILED',
    });
    return;
  }

  res.status(201).json({
    success: true,
    data: enrollment,
    message: `Enrolled in ${course.title}`,
  });
}));

export default router;