/**
 * iGOT API Integration Route
 * 
 * Integrates with the iGOT Karmayogi platform's course catalogue.
 * Provides access to iGOT online courses, TPAC classroom sessions, and MoSPI courses.
 * 
 * Why: SkillUp aggregates courses from multiple sources including iGOT to provide
 * a comprehensive learning catalog for officials.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * Validation schemas
 */
const iGOTCourseFilterSchema = z.object({
  source: z.enum(['iGOT', 'NSSTA_TPAC', 'MoSPI_Internal']).optional(),
  domain: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  page_size: z.coerce.number().min(1).max(50).default(20),
  is_tpac_classroom: z.coerce.boolean().optional(),
});

/**
 * GET /api/igot/courses
 * 
 * Returns paginated list of iGOT courses with optional filters.
 * 
 * Why: Provides centralized access to all iGOT courses with filtering options.
 */
router.get('/courses', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    source,
    domain,
    search,
    page = 1,
    page_size = 20,
    is_tpac_classroom,
  } = iGOTCourseFilterSchema.parse(req.query);

  // Build query
  // NOTE: courses has no FK to competency_domains — embedding it makes
  // PostgREST reject the whole query ("Could not find a relationship").
  let query = supabaseAdmin
    .from('courses')
    .select('*', { count: 'exact' });

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
  const { data: courses, error, count } = await query;

  if (error) {
    console.error('iGOT course fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch iGOT courses',
      code: 'FETCH_FAILED',
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
}));

/**
 * GET /api/igot/courses/:id
 * 
 * Returns detailed course information from iGOT catalogue.
 * 
 * Why: Users need full course details before enrolling.
 */
router.get('/courses/:id', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  // NOTE: no domain embed here (no FK); see target_competency_details below.
  const { data: course, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !course) {
    res.status(404).json({
      success: false,
      error: 'iGOT course not found',
      code: 'NOT_FOUND',
    });
    return;
  }

  // Get target competencies details (entries may be UUIDs or plain names)
  if (course.target_competencies && course.target_competencies.length > 0) {
    const entries = course.target_competencies.map((v: unknown) => String(v));
    const allUuid = entries.every((v: string) => /^[0-9a-f-]{36}$/i.test(v));
    let q = supabaseAdmin
      .from('competencies')
      .select('id, name, domain_id, domain:competency_domains(name)');
    q = allUuid ? q.in('id', entries) : q.in('name', entries);
    const { data: competencies } = await q;

    (course as Record<string, unknown>).target_competency_details = competencies;
  }

  res.json({
    success: true,
    data: course,
  });
}));

/**
 * GET /api/igot/courses/enrolled
 * 
 * Returns courses the user is enrolled in from iGOT.
 * 
 * Why: Users need to see their iGOT enrollment status.
 */
router.get('/courses/enrolled', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  // Get user's enrolled courses (from assessment attempts as proxy)
  const { data: attempts, error } = await supabaseAdmin
    .from('assessment_attempts')
    .select(`
      *,
      course:courses(*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Enrolled courses fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch enrolled courses',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: attempts || [],
  });
}));

/**
 * GET /api/igot/courses/tpac/calendar
 * 
 * Returns upcoming TPAC classroom sessions from iGOT.
 * 
 * Why: NSSTA TPAC classroom sessions are important learning opportunities.
 */
router.get('/courses/tpac/calendar', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
 * POST /api/igot/enroll/:courseId
 * 
 * Enrolls the user in an iGOT course.
 * 
 * Why: Records user enrollment for iGOT course progress tracking.
 */
router.post('/enroll/:courseId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { courseId } = req.params;
  const userId = req.user!.id;

  // Check if course exists
  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('id, title, course_url')
    .eq('id', courseId)
    .single();

  if (!course) {
    res.status(404).json({
      success: false,
      error: 'iGOT course not found',
      code: 'NOT_FOUND',
    });
    return;
  }

  // Create enrollment record (using assessment_attempts as enrollment proxy)
  const { data: enrollment, error } = await supabaseAdmin
    .from('assessment_attempts')
    .insert({
      user_id: userId,
      course_id: courseId,
      status: 'pending',
      passed: false,
      tab_switch_count: 0,
      fullscreen_exits: 0,
      time_taken_seconds: 0,
      telemetry_flags: [],
    })
    .select()
    .single();

  if (error) {
    console.error('Enrolled courses fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to enroll in iGOT course',
      code: 'ENROLLMENT_FAILED',
    });
    return;
  }

  res.status(201).json({
    success: true,
    data: enrollment,
    message: `Enrolled in ${course.title} from iGOT Karmayogi`,
  });
}));

export default router;