/**
 * Admin Routes
 * 
 * Handles administrative operations including:
 * - Dashboard overview and analytics
 * - Assessment review queue (HITL verification)
 * - User management
 * - Organization-wide competency analysis
 * 
 * Why: Admins need to manage the platform, review assessments,
 * and view organization-wide analytics.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler, NotFoundError, ForbiddenError } from '../middleware/errorHandler.js';
import { requireAdmin, requireManager, type AuthenticatedRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply admin/manager authorization to all routes
router.use(requireManager);

/**
 * Validation schemas
 */
const reviewSchema = z.object({
  final_verified_score: z.number().min(0).max(100),
  review_status: z.enum(['approved', 'rejected', 'flagged']),
  admin_notes: z.string().optional(),
});

const userUpdateSchema = z.object({
  role: z.enum(['learner', 'manager', 'admin']).optional(),
  designation: z.string().optional(),
  department: z.string().optional(),
  is_active: z.boolean().optional(),
});

/**
 * GET /api/admin/dashboard
 * 
 * Returns organization-wide dashboard statistics.
 * 
 * Why: Admins need to see the big picture - total users,
 * average proficiency, training effectiveness, etc.
 */
router.get('/dashboard', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  // Get total users count
  const { count: totalUsers } = await supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  // Get average proficiency (average of all competency scores)
  const { data: allScores } = await supabaseAdmin
    .from('user_competency_scores')
    .select('current_score');

  const avgProficiency = allScores && allScores.length > 0
    ? allScores.reduce((sum, s) => sum + s.current_score, 0) / allScores.length
    : 0;

  // Get course completion statistics
  const { count: completedCourses } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('passed', true);

  // Get pending reviews count
  const { count: pendingReviews } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  // Get certificates issued
  const { count: certificatesIssued } = await supabaseAdmin
    .from('certificates')
    .select('*', { count: 'exact', head: true });

  // Calculate training effectiveness (passed / attempted)
  const { count: totalAttempts } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*', { count: 'exact', head: true });

  const trainingEffectiveness = totalAttempts && totalAttempts > 0
    ? ((completedCourses || 0) / totalAttempts) * 100
    : 0;

  // Get department distribution
  const { data: deptDistribution } = await supabaseAdmin
    .from('profiles')
    .select('department')
    .then(({ data }) => {
      const deptCounts: Record<string, number> = {};
      data?.forEach((p) => {
        deptCounts[p.department] = (deptCounts[p.department] || 0) + 1;
      });
      return { data: Object.entries(deptCounts).map(([dept, count]) => ({ department: dept, count })) };
    });

  // Get top skill gaps across organization
  const { data: topGaps } = await supabaseAdmin
    .from('user_competency_scores')
    .select(`
      gap_score,
      competency:competencies(name, domain:competency_domains(name))
    `)
    .order('gap_score', { ascending: false })
    .limit(10);

  // Aggregate by competency
  const gapMap = new Map<string, { name: string; domain: string; totalGap: number; count: number }>();
  topGaps?.forEach((g) => {
    const name = g.competency?.name || 'Unknown';
    const domain = g.competency?.domain?.name || 'Unknown';
    const existing = gapMap.get(name);
    if (existing) {
      existing.totalGap += g.gap_score;
      existing.count++;
    } else {
      gapMap.set(name, { name, domain, totalGap: g.gap_score, count: 1 });
    }
  });

  const topSkillGaps = Array.from(gapMap.values())
    .map((g) => ({
      competency: g.name,
      domain: g.domain,
      average_gap: Math.round((g.totalGap / g.count) * 10) / 10,
    }))
    .sort((a, b) => b.average_gap - a.average_gap)
    .slice(0, 5);

  res.json({
    success: true,
    data: {
      overview: {
        total_officials: totalUsers || 0,
        average_proficiency: Math.round(avgProficiency * 10) / 10,
        training_effectiveness: Math.round(trainingEffectiveness * 10) / 10,
        certificates_issued: certificatesIssued || 0,
      },
      pending_reviews: pendingReviews || 0,
      completed_courses: completedCourses || 0,
      department_distribution: deptDistribution || [],
      top_skill_gaps: topSkillGaps,
    },
  });
}));

/**
 * GET /api/admin/reviews
 * 
 * Returns pending assessment reviews for admin approval.
 * 
 * Why: Admin needs to review and approve assessment attempts
 * as part of the Human-In-The-Loop verification process.
 */
router.get('/reviews', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { status, page = 1, page_size = 20 } = req.query;

  const from = (Number(page) - 1) * Number(page_size);
  const to = from + Number(page_size) - 1;

  let query = supabaseAdmin
    .from('assessment_attempts')
    .select(`
      *,
      user:profiles(id, full_name, designation, department, email),
      course:courses(id, title, provider)
    `, { count: 'exact' });

  if (status) {
    query = query.eq('status', status as string);
  } else {
    // Default to pending
    query = query.eq('status', 'pending');
  }

  const { data: attempts, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Review fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reviews',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: attempts || [],
    pagination: {
      total: count || 0,
      page: Number(page),
      page_size: Number(page_size),
      total_pages: Math.ceil((count || 0) / Number(page_size)),
    },
  });
}));

/**
 * POST /api/admin/reviews/:attemptId
 * 
 * Reviews and approves/rejects an assessment attempt.
 * 
 * Why: This is the HITL verification endpoint. Admin reviews
 * the attempt, adjusts the score if needed, and approves.
 */
router.post('/reviews/:attemptId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { attemptId } = req.params;
  const adminId = req.user!.id;

  // Validate request
  const { final_verified_score, review_status, admin_notes } = reviewSchema.parse(req.body);

  // Get the attempt
  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*')
    .eq('id', attemptId)
    .single();

  if (!attempt) {
    throw new NotFoundError('Assessment attempt');
  }
  if (attempt.status !== 'pending') {
    res.status(409).json({ success: false, error: 'This exam has already been verified and its marks are locked', code: 'MARKS_LOCKED' });
    return;
  }

  // Update the attempt status
  const { error: updateError } = await supabaseAdmin
    .from('assessment_attempts')
    .update({
      status: review_status,
      auto_score: final_verified_score,
      passed: review_status === 'approved' && final_verified_score >= 70,
    })
    .eq('id', attemptId);

  if (updateError) {
    console.error('Review update error:', updateError);
    res.status(500).json({
      success: false,
      error: 'Failed to update review',
      code: 'UPDATE_FAILED',
    });
    return;
  }

  // Create review record
  const { data: review, error: reviewError } = await supabaseAdmin
    .from('assessment_reviews')
    .insert({
      attempt_id: attemptId,
      user_id: attempt.user_id,
      auto_score: attempt.auto_score || 0,
      final_verified_score,
      review_status,
      verified_by: adminId,
      admin_notes,
    })
    .select()
    .single();

  if (reviewError) {
    console.error('Review creation error:', reviewError);
  }

  // If approved, update competency scores
  if (review_status === 'approved' && attempt.course_id) {
    const { data: course } = await supabaseAdmin
      .from('courses')
      .select('target_competencies')
      .eq('id', attempt.course_id)
      .single();

    if (course?.target_competencies) {
      for (const compId of course.target_competencies) {
        // Increase score based on verified performance
        const scoreIncrease = (final_verified_score / 100) * 0.5;
        
        await supabaseAdmin.rpc('increment_competency_score', {
          p_user_id: attempt.user_id,
          p_competency_id: compId,
          p_increase: scoreIncrease,
        });
      }
    }

    // Approval is the only path that issues a certificate. The unique course
    // check makes this idempotent if an admin retries the approval request.
    const { data: existingCertificate } = await supabaseAdmin
      .from('certificates')
      .select('id')
      .eq('user_id', attempt.user_id)
      .eq('course_id', attempt.course_id)
      .maybeSingle();
    if (!existingCertificate) {
      const { error: certificateError } = await supabaseAdmin.from('certificates').insert({
        user_id: attempt.user_id,
        course_id: attempt.course_id,
        verification_code: `SU-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        auto_score: attempt.auto_score || 0,
        verified_score: final_verified_score,
        signed_by_admin: adminId,
      });
      if (certificateError) {
        console.error('Certificate issuance error:', certificateError);
        res.status(500).json({ success: false, error: 'Exam approved but certificate issuance failed', code: 'CERTIFICATE_FAILED' });
        return;
      }
    }
  }

  res.json({
    success: true,
    data: {
      attempt_id: attemptId,
      status: review_status,
      verified_score: final_verified_score,
      reviewed_by: adminId,
    },
    message: `Assessment ${review_status}`,
  });
}));

/**
 * GET /api/admin/users
 * 
 * Returns all users with optional filters.
 * 
 * Why: Admin needs to manage users and view their status.
 */
router.get('/users', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { department, role, search, page = 1, page_size = 20 } = req.query;

  const from = (Number(page) - 1) * Number(page_size);
  const to = from + Number(page_size) - 1;

  let query = supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact' });

  if (department) {
    query = query.eq('department', department as string);
  }
  if (role) {
    query = query.eq('role', role as string);
  }
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data: users, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('User fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: users || [],
    pagination: {
      total: count || 0,
      page: Number(page),
      page_size: Number(page_size),
      total_pages: Math.ceil((count || 0) / Number(page_size)),
    },
  });
}));

/**
 * PUT /api/admin/users/:userId
 * 
 * Updates a user's profile and role.
 * 
 * Why: Admin can modify user roles and details.
 */
router.put('/users/:userId', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { userId } = req.params;
  const validatedData = userUpdateSchema.parse(req.body);

  const { data: user, error } = await supabaseAdmin
    .from('profiles')
    .update({
      ...validatedData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('User update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user',
      code: 'UPDATE_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: user,
    message: 'User updated successfully',
  });
}));

/**
 * GET /api/admin/heatmap
 * 
 * Returns department x competency matrix for heatmap visualization.
 * 
 * Why: Admins need to see which competencies are strong/weak
 * in each department for workforce planning.
 */
router.get('/heatmap', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  // Get all departments
  const { data: departments } = await supabaseAdmin
    .from('profiles')
    .select('department')
    .then(({ data }) => {
      const depts = new Set<string>();
      data?.forEach((p) => depts.add(p.department));
      return { data: Array.from(depts) };
    });

  // Get all competencies
  const { data: competencies } = await supabaseAdmin
    .from('competencies')
    .select('id, name, domain:competency_domains(name)');

  // Build heatmap data
  const heatmap: Record<string, Record<string, { score: number; count: number }>> = {};

  for (const dept of departments || []) {
    heatmap[dept] = {};
    
    for (const comp of competencies || []) {
      // Get average score for this department and competency
      const { data: scores } = await supabaseAdmin
        .from('user_competency_scores')
        .select('current_score')
        .eq('competency_id', comp.id)
        .then(async ({ data: scoreData }) => {
          // Get users in this department
          const { data: users } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('department', dept);
          
          const userIds = users?.map((u) => u.id) || [];
          const relevantScores = scoreData?.filter((s) => userIds.includes(s.user_id)) || [];
          
          return {
            data: relevantScores.length > 0
              ? [{ avg: relevantScores.reduce((a, b) => a + b.current_score, 0) / relevantScores.length }]
              : []
          };
        });

      const avgScore = scores?.[0]?.avg || 0;
      heatmap[dept][comp.name] = {
        score: Math.round(avgScore * 10) / 10,
        count: scores?.length || 0,
      };
    }
  }

  res.json({
    success: true,
    data: {
      departments: departments || [],
      competencies: competencies?.map((c) => ({ id: c.id, name: c.name, domain: c.domain?.name })) || [],
      heatmap,
    },
  });
}));

/**
 * GET /api/admin/des-heatmap
 * For PDF: Departmental Competency Heatmap — regional skill gaps across DES State/District
 * Why: MoSPI directors need State (DES) view, not just department NSSO/CSO
 */
router.get('/des-heatmap', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  // Use view des_competency_heatmap if exists, else aggregate
  const { data: heatmapRows, error } = await supabaseAdmin.from('des_competency_heatmap').select('*');
  if (!error && heatmapRows && heatmapRows.length) {
    // pivot: state -> domain -> avg_score
    const states = Array.from(new Set(heatmapRows.map((r:any)=>r.state)));
    const domains = Array.from(new Set(heatmapRows.map((r:any)=>r.domain)));
    const pivot: Record<string, Record<string, number>> = {};
    heatmapRows.forEach((r:any)=>{ if(!pivot[r.state]) pivot[r.state]={}; pivot[r.state][r.domain]= Math.round(r.avg_score*10)/10; });
    res.json({ success:true, data:{ states, domains, heatmap: pivot, raw: heatmapRows } });
    return;
  }
  // Fallback: compute from profiles.state
  const { data: profs } = await supabaseAdmin.from('profiles').select('id, state');
  const { data: domains } = await supabaseAdmin.from('competency_domains').select('id, name');
  const { data: scores } = await supabaseAdmin.from('user_competency_scores').select('user_id, current_score, competency:competencies(domain_id)');
  const stateMap: Record<string, Record<string, {sum:number,cnt:number}>> = {};
  scores?.forEach((s:any)=>{
    const prof = profs?.find(p=>p.id===s.user_id);
    const state = prof?.state || 'Unknown';
    const domId = s.competency?.domain_id;
    const dom = domains?.find(d=>d.id===domId)?.name || 'Unknown';
    if(!stateMap[state]) stateMap[state]={};
    if(!stateMap[state][dom]) stateMap[state][dom]={sum:0,cnt:0};
    stateMap[state][dom].sum+= Number(s.current_score||0);
    stateMap[state][dom].cnt+=1;
  });
  const heatmap: Record<string, Record<string, number>> = {};
  Object.keys(stateMap).forEach(state=>{
    heatmap[state]={};
    Object.keys(stateMap[state]).forEach(dom=>{
      const v=stateMap[state][dom];
      heatmap[state][dom]= Math.round((v.sum/v.cnt)*10)/10;
    });
  });
  res.json({ success:true, data:{ states: Object.keys(heatmap), domains: domains?.map(d=>d.name)||[], heatmap, raw: [] } });
}));

/**
 * POST /api/admin/predict
 * 
 * What-if simulation for workforce capability changes.
 * 
 * Why: Admins can simulate the impact of training programs
 * or workforce changes on organizational competency.
 */
router.post('/predict', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { scenario } = req.body;

  // This is a simplified simulation
  // In production, would use ML models for predictive analytics

  // Get current baseline
  const { data: currentScores } = await supabaseAdmin
    .from('user_competency_scores')
    .select('current_score');

  const currentAvg = currentScores?.length
    ? currentScores.reduce((sum, s) => sum + s.current_score, 0) / currentScores.length
    : 0;

  // Simulate scenario impact
  let predictedAvg = currentAvg;
  let description = '';

  switch (scenario) {
    case 'training_10_percent':
      predictedAvg = currentAvg + 0.3;
      description = 'If 10% of officials complete advanced training';
      break;
    case 'new_hires_5':
      predictedAvg = currentAvg - 0.1;
      description = 'If 5 new officials join with baseline skills';
      break;
    case 'mandatory_upskill':
      predictedAvg = currentAvg + 0.5;
      description = 'If all officials complete mandatory upskilling';
      break;
    default:
      predictedAvg = currentAvg;
  }

  res.json({
    success: true,
    data: {
      current_average: Math.round(currentAvg * 10) / 10,
      predicted_average: Math.round(Math.min(5, predictedAvg) * 10) / 10,
      improvement: Math.round((predictedAvg - currentAvg) * 10) / 10,
      scenario_description: description,
    },
  });
}));

export default router;
