/**
 * Competency Routes
 * 
 * Handles competency taxonomy operations including:
 * - Listing competency domains
 * - Listing competencies within domains
 * - Getting skill gap analysis
 * - AI-powered competency assessment
 * 
 * Why: Competencies are the core of the skill intelligence system.
 * These routes provide access to the competency taxonomy and gap analysis.
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/competencies/domains
 * 
 * Returns all competency domains (4 mandated areas).
 * 
 * Why: Users need to see the overall competency structure.
 */
router.get('/domains', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { data: domains, error } = await supabaseAdmin
    .from('competency_domains')
    .select('*')
    .order('name');

  if (error) {
    console.error('Domain fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch domains',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: domains || [],
  });
}));

/**
 * GET /api/competencies
 * 
 * Returns all competencies, optionally filtered by domain.
 * 
 * Why: Users need to see available skills within each domain.
 */
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { domain_id, search } = req.query;

  let query = supabaseAdmin
    .from('competencies')
    .select(`
      *,
      domain:competency_domains(id, name)
    `);

  if (domain_id) {
    query = query.eq('domain_id', domain_id as string);
  }
  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data: competencies, error } = await query.order('name');

  if (error) {
    console.error('Competency fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch competencies',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: competencies || [],
  });
}));

/**
 * GET /api/competencies/gaps
 *
 * Returns skill gap analysis for the current user.
 *
 * Why: This is the core skill-gap matrix endpoint for the dashboard.
 * - High Gap: gap_score >= 2.0 (needs immediate attention)
 * - Medium Gap: gap_score >= 1.0 && < 2.0 (should address)
 * - Achieved: gap_score < 1.0 (competency met)
 */
router.get('/gaps', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  // Get all competency scores for user with competency details
  const { data: scores, error } = await supabaseAdmin
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
    .eq('user_id', userId);

  if (error) {
    console.error('Gap analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze gaps',
      code: 'ANALYSIS_FAILED',
    });
    return;
  }

  // Categorize gaps (fallback compute if column missing/null for old rows)
  const withGap = (scores || []).map((s: any) => ({ ...s, gap_score: s.gap_score ?? (s.required_score - s.current_score) }));
  const highGaps = withGap.filter((s: any) => s.gap_score >= 2.0);
  const mediumGaps = withGap.filter((s: any) => s.gap_score >= 1.0 && s.gap_score < 2.0);
  const achieved = withGap.filter((s: any) => s.gap_score < 1.0);

  // Calculate overall progress
  const totalRequired = scores?.reduce((sum, s) => sum + s.required_score, 0) || 0;
  const totalCurrent = scores?.reduce((sum, s) => sum + s.current_score, 0) || 0;
  const overallProgress = totalRequired > 0 ? (totalCurrent / totalRequired) * 100 : 0;

  // Group by domain for heatmap
  const domainMap = new Map<string, { domain: string; totalScore: number; count: number }>();
  
  scores?.forEach((score) => {
    const domainName = score.competency?.domain?.name || 'Unknown';
    const existing = domainMap.get(domainName);
    if (existing) {
      existing.totalScore += score.current_score;
      existing.count++;
    } else {
      domainMap.set(domainName, {
        domain: domainName,
        totalScore: score.current_score,
        count: 1,
      });
    }
  });

  const domainProgress = Array.from(domainMap.values()).map((d) => ({
    domain: d.domain,
    average_score: d.count > 0 ? d.totalScore / d.count : 0,
    competency_count: d.count,
  }));

  res.json({
    success: true,
    data: {
      overall_progress: Math.round(overallProgress * 10) / 10,
      summary: {
        high_gap_count: highGaps.length,
        medium_gap_count: mediumGaps.length,
        achieved_count: achieved.length,
        total_competencies: scores?.length || 0,
      },
      gaps: {
        high: highGaps.map((s) => ({
          ...s.competency,
          domain: s.competency?.domain?.name || 'Unknown',
          current_score: s.current_score,
          required_score: s.required_score,
          gap_score: s.gap_score,
        })),
        medium: mediumGaps.map((s) => ({
          ...s.competency,
          domain: s.competency?.domain?.name || 'Unknown',
          current_score: s.current_score,
          required_score: s.required_score,
          gap_score: s.gap_score,
        })),
        achieved: achieved.map((s) => ({
          ...s.competency,
          domain: s.competency?.domain?.name || 'Unknown',
          current_score: s.current_score,
          required_score: s.required_score,
          gap_score: s.gap_score,
        })),
      },
      domain_progress: domainProgress,
    },
  });
}));

/**
 * POST /api/competencies/assess
 *
 * Runs AI-powered competency assessment.
 * Evaluates user's competency levels based on their profile and responses.
 *
 * Why: This is the initial baseline assessment endpoint.
 * Uses AI to analyze designation, experience, and background to set initial scores.
 */
router.post('/assess', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  // Accept survey payload so assess can be seeded directly from survey (familiarity_scores)
  const { familiarity_scores, designation, department, years_experience, education } = (req.body || {}) as {
    familiarity_scores?: Record<string, number>;
    designation?: string;
    department?: string;
    years_experience?: number;
    education?: string;
  };

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (!profile) {
    res.status(404).json({
      success: false,
      error: 'Profile not found',
      code: 'PROFILE_NOT_FOUND',
    });
    return;
  }

  // Get all competencies
  const { data: competencies } = await supabaseAdmin
    .from('competencies')
    .select('*');

  const dept = (department as string) || profile.department || '';
  const desg = (designation as string) || profile.designation || '';
  const departmentBaseline = getDepartmentBaseline(dept, desg);

  // If survey familiarity_scores were sent, they are the truth (frontend ids like survey_sampling, ai_ml, r_stats)
  // Map them to DB competency names robustly; otherwise use department baseline.
  const scores = (competencies || []).map((comp) => {
    let fromSurvey: number | undefined;
    if (familiarity_scores && typeof familiarity_scores === 'object') {
      const idKey = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const aliasMap: Record<string, string> = { r_for_statistics: 'r_stats', sql_databases: 'sql', ai_machine_learning: 'ai_ml', data_visualisation: 'data_viz', data_visualization: 'data_viz' };
      const lowerFam: Record<string, number> = {};
      for (const [k, v] of Object.entries(familiarity_scores)) lowerFam[k.toLowerCase()] = Number(v);
      fromSurvey = lowerFam[comp.name.toLowerCase()] ?? lowerFam[idKey] ?? lowerFam[aliasMap[idKey]] ?? lowerFam[aliasMap[idKey.toLowerCase()]];
      // reverse alias: fam has r_stats -> DB "R" / "R for Statistics" variations
      if (fromSurvey === undefined) {
        const reverseAlias: Record<string, string[]> = { r_stats: ['r_for_statistics', 'r'], ai_ml: ['ai_machine_learning', 'ai_ml'], sql: ['sql_databases'], data_viz: ['data_visualisation', 'data_visualization'] };
        for (const [famKey, dbKeys] of Object.entries(reverseAlias)) {
          if (dbKeys.includes(idKey) && lowerFam[famKey] !== undefined) fromSurvey = lowerFam[famKey];
        }
      }
    }
    const current = fromSurvey !== undefined ? Math.min(5, Math.max(1, fromSurvey + 1)) : (departmentBaseline[comp.name] ?? 1.5);
    const required = 4.0;
    return {
      user_id: userId,
      competency_id: comp.id,
      current_score: current,
      required_score: required,
      // gap_score is GENERATED column (required_score - current_score); do NOT insert
      updated_at: new Date().toISOString(),
    };
  });

  // Upsert all scores
  const { error } = await supabaseAdmin
    .from('user_competency_scores')
    .upsert(scores, { onConflict: 'user_id,competency_id' });

  if (error) {
    console.error('Assessment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run assessment',
      code: 'ASSESSMENT_FAILED',
    });
    return;
  }

  // Also return categorized gaps so frontend can show immediate feedback
  const high = scores.filter(s => (s.required_score - s.current_score) >= 2).length;
  const medium = scores.filter(s => (s.required_score - s.current_score) >= 1 && (s.required_score - s.current_score) < 2).length;
  res.json({
    success: true,
    message: 'Competency assessment completed',
    data: {
      assessed_competencies: competencies?.length || 0,
      baseline_used: dept,
      survey_applied: !!familiarity_scores,
      gaps: { high, medium, achieved: (scores.length - high - medium) },
    },
  });
}));

/**
 * GET /api/competencies/:id
 *
 * Keep this catch-all route after all named competency routes. Express matches
 * routes in declaration order, so placing it earlier makes /gaps and /assess
 * get treated as competency IDs.
 */
// UUID constraint makes this route safe even if an older compiled server has
// a different declaration order: /gaps and /domains can never be IDs.
router.get('/:id([0-9a-fA-F-]{36})', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id);

  const { data: competency, error } = await supabaseAdmin
    .from('competencies')
    .select(`
      *,
      domain:competency_domains(*)
    `)
    .eq('id', id)
    .single();

  if (error || !competency) {
    res.status(404).json({
      success: false,
      error: 'Competency not found',
      code: 'NOT_FOUND',
    });
    return;
  }

  res.json({
    success: true,
    data: competency,
  });
}));

/**
 * Helper: Get baseline scores based on department and designation
 * 
 * This provides reasonable default scores for demo purposes.
 * In production, AI would analyze the profile in detail.
 */
function getDepartmentBaseline(department: string, designation: string): Record<string, number> {
  const baselines: Record<string, Record<string, number>> = {
    NSSO: {
      'Survey Sampling': 3.5,
      'Data Quality': 3.0,
      'Statistical Analysis': 3.5,
      Python: 2.0,
      SQL: 3.0,
      GIS: 2.5,
      'Data Privacy': 2.0,
      Cybersecurity: 1.5,
      Leadership: 2.0,
    },
    CSO: {
      'National Accounts': 3.5,
      'SDG Indicators': 3.0,
      'Statistical Analysis': 4.0,
      Python: 2.5,
      R: 2.5,
      SQL: 3.5,
      'Data Privacy': 2.5,
      Leadership: 2.5,
    },
    DIID: {
      'Data Analysis': 3.0,
      'Report Writing': 3.5,
      Python: 2.0,
      SQL: 2.5,
      'Digital Governance': 2.5,
      Communication: 3.0,
    },
  };

  // Try to match department, fallback to generic
  for (const [dept, scores] of Object.entries(baselines)) {
    if (department.toUpperCase().includes(dept)) {
      return scores;
    }
  }

  // Default baseline
  return {
    'Survey Sampling': 2.0,
    'Statistical Analysis': 2.0,
    Python: 1.5,
    SQL: 2.0,
    'Data Privacy': 1.5,
    Leadership: 2.0,
    Communication: 2.0,
  };
}

export default router;
