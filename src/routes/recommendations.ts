/**
 * Recommendation Routes
 * 
 * Hybrid recommender using knowledge graph:
 * - Content-based (skill gaps → courses)
 * - Collaborative filtering (similar users)
 * - Rule-based (mandatory trainings)
 * 
 * Why: Government officials need explainable recommendations.
 * Every recommendation comes with a WHY explanation.
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { KnowledgeGraphService } from '../services/knowledgeGraph.js';

const kgService = new KnowledgeGraphService();
const router = Router();

/**
 * GET /api/recommendations
 * 
 * Returns personalized course recommendations with XAI explanations.
 */
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const rawLimit = Number(req.query.limit ?? 3);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 3, 1), 3);

  try {
    const recommendations = await kgService.recommendCourses(userId, limit);
    
    // Get course details
    const courseIds = recommendations.map(r => r.course_id);
    const { data: courses } = await supabaseAdmin
      .from('courses')
      .select('*')
      .in('id', courseIds);

    const courseMap = new Map((courses || []).map(c => [c.id, c]));

    const enriched = recommendations.map(rec => ({
      ...rec,
      course: courseMap.get(rec.course_id) || null,
    }));

    res.json({
      success: true,
      data: enriched,
      meta: {
        total: enriched.length,
        algorithm: 'hybrid_kg',
        features: [
          'skill_gap_matching',
          'peer_collaboration',
          'mandatory_compliance',
          'role_based',
          'xai_explanations',
        ],
      },
    });
  } catch (err) {
    console.error('Recommendation error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to generate recommendations',
    });
  }
}));

/**
 * POST /api/recommendations/generate
 * 
 * Regenerates recommendations (triggered after survey or assessment).
 */
router.post('/generate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  try {
    // Run assessment with survey data
    const { data: survey } = await supabaseAdmin
      .from('surveys')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const departmentBaseline = getDepartmentBaseline(survey?.current_designation || '', survey?.years_experience || 0);

    // Get all competencies
    const { data: competencies } = await supabaseAdmin
      .from('competencies')
      .select('*');

    // Generate baseline scores from survey familiarity
    const fam = survey?.familiarity_scores || {};
    // Normalize familiarity keys once (lowercase)
    const lowerFam: Record<string, number> = {};
    for (const [k, v] of Object.entries(fam)) lowerFam[k.toLowerCase()] = Number(v);
    const FRONTEND_ID_TO_DB_NAME: Record<string, string> = {
      survey_sampling: 'Survey Sampling', national_accounts: 'National Accounts', sdg_indicators: 'SDG Indicators',
      data_quality: 'Data Quality', census_ops: 'Census Operations', python: 'Python', r_stats: 'R', sql: 'SQL', gis: 'GIS',
      ai_ml: 'AI/ML', data_viz: 'Data Visualization', cybersecurity: 'Cybersecurity', data_privacy: 'Data Privacy',
      dpi: 'DPI', egovernance: 'e-Governance', leadership: 'Leadership', communication: 'Communication', ethics: 'Ethics',
      project_mgmt: 'Project Management', change_mgmt: 'Change Management',
    };
    // Reverse lookup: db normalized id -> frontend id
    const dbAliasToFam = (idKey: string): number | undefined => {
      // direct frontend id
      if (lowerFam[idKey] !== undefined) return lowerFam[idKey];
      // map frontend id -> db name -> check if current comp's idKey matches any frontend id's db mapping
      for (const [famId, dbName] of Object.entries(FRONTEND_ID_TO_DB_NAME)) {
        const famDbId = dbName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (famDbId === idKey && lowerFam[famId] !== undefined) return lowerFam[famId];
      }
      return undefined;
    };
    const scores = (competencies || []).map(comp => {
      const nameKey = comp.name;
      const idKey = nameKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      let val: number | undefined = lowerFam[nameKey.toLowerCase()] ?? dbAliasToFam(idKey);
      const current = val !== undefined ? Math.min(5, Math.max(1, val + 1)) : (departmentBaseline[nameKey] ?? 1.5);
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

    // Upsert scores
    for (const score of scores) {
      const { error } = await supabaseAdmin
        .from('user_competency_scores')
        .upsert(score, { onConflict: 'user_id,competency_id' });
      if (error) console.error('Score upsert error:', error);
    }

    // Clear old explanations BEFORE generating (so kgService insert survives)
    await supabaseAdmin.from('recommendation_explanations').delete().eq('user_id', userId);

    // Generate recommendations (hybrid graph; persists explanations)
    let recommendations = await kgService.recommendCourses(userId);

    // Fallback: if KG produced nothing (no gaps / no courses seeded), return top courses as recommendations so UI never looks empty after survey
    if (recommendations.length === 0) {
      const { data: topCourses } = await supabaseAdmin.from('courses').select('*').order('duration_hours').limit(5);
      recommendations = (topCourses || []).slice(0, 3).map((c: any, idx: number) => ({
        course_id: c.id,
        course_title: c.title,
        priority: (idx < 2 ? 'high' : 'medium') as 'high' | 'medium',
        score: 0.6 - idx * 0.05,
        explanation: `Starter recommendation based on your role. Enroll to build foundational skills.`,
        factors: [{ factor: 'starter_path', weight: 0.6, detail: 'Popular for your department' }],
        algorithm: 'hybrid' as 'hybrid',
        confidence: 0.6,
        course: c,
      }));
      // Persist fallback explanations so GET /api/recommendations can also show something if it re-reads from table? But we keep them in response shape.
      if (recommendations.length) {
        await supabaseAdmin.from('recommendation_explanations').insert(
          recommendations.map((r: any) => ({
            user_id: userId,
            course_id: r.course_id,
            explanation: r.explanation,
            factors: r.factors,
            algorithm: r.algorithm,
            confidence: r.confidence,
          }))
        );
      }
    }

    res.json({
      success: true,
      data: {
        assessed_competencies: competencies?.length || 0,
        recommendations_generated: recommendations.length,
        recommendations: recommendations.slice(0, 3),
        message: 'Survey processed, recommendations generated',
      },
    });
  } catch (err) {
    console.error('Recommendation generation error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to generate recommendations',
    });
  }
}));

/**
 * GET /api/recommendations/explanations
 * 
 * Returns XAI explanations for recommendations.
 */
router.get('/explanations', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from('recommendation_explanations')
    .select('*, course:courses(title, provider, source, duration_hours)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch explanations' });
    return;
  }

  res.json({ success: true, data });
}));

/**
 * GET /api/recommendations/similar
 * 
 * Returns similar users (collaborative filter explanation).
 */
router.get('/similar', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const similarUsers = await kgService.getSimilarUsers(userId);

  res.json({
    success: true,
    data: similarUsers,
  });
}));

/**
 * GET /api/recommendations/workforce-forecast
 * 
 * Returns predictive workforce analytics.
 */
router.get('/workforce-forecast', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { department = 'MoSPI', horizon = 12 } = req.query;

  const forecasts = await kgService.forecastSkillShortages(
    department as string,
    Number(horizon)
  );

  res.json({
    success: true,
    data: forecasts,
    meta: {
      department,
      horizon_months: Number(horizon),
      generated_at: new Date().toISOString(),
    },
  });
}));

function getDepartmentBaseline(designation: string, years: number): Record<string, number> {
  const expMultiplier = years > 10 ? 1.2 : years > 5 ? 1.0 : 0.8;
  return {
    'Survey Sampling': 2.5 * expMultiplier,
    'National Accounts': 2.0 * expMultiplier,
    'SDG Indicators': 2.0 * expMultiplier,
    'Data Quality': 2.5 * expMultiplier,
    'Census Operations': 2.0 * expMultiplier,
    'Python': 1.5 * expMultiplier,
    'R': 1.5 * expMultiplier,
    'SQL': 2.0 * expMultiplier,
    'GIS': 1.5 * expMultiplier,
    'AI/ML': 1.0 * expMultiplier,
    'Data Visualization': 1.5 * expMultiplier,
    'Cybersecurity': 1.0 * expMultiplier,
    'Data Privacy': 1.5 * expMultiplier,
    'DPI': 1.0 * expMultiplier,
    'e-Governance': 1.5 * expMultiplier,
    'Govt Cloud': 1.0 * expMultiplier,
    'Leadership': 2.0 * expMultiplier,
    'Communication': 2.5 * expMultiplier,
    'Ethics': 3.0 * expMultiplier,
    'Change Management': 2.0 * expMultiplier,
    'Project Management': 2.0 * expMultiplier,
    'Time Management': 2.5 * expMultiplier,
    'Decision Making': 2.5 * expMultiplier,
  };
}

export default router;