/**
 * Survey Routes - Pre-Assessment Survey
 * 
 * Saves user survey responses and triggers AI assessment + recommendations.
 * 
 * Why: Survey is the entry point for personalized learning paths.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const surveySchema = z.object({
  role_id: z.string().optional().nullable(),
  current_designation: z.string().optional(),
  years_experience: z.number().optional(),
  education_level: z.string().optional(),
  familiarity_scores: z.record(z.string(), z.number()).optional(),
  learning_goals: z.array(z.string()).optional(),
  preferred_modality: z.string().optional(),
  preferred_language: z.string().optional(),
  time_availability: z.string().optional(),
});

/**
 * POST /api/surveys
 * 
 * Saves survey response and triggers downstream AI processing.
 */
router.post('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const data = surveySchema.parse(req.body);

  // Save survey
  const { data: survey, error } = await supabaseAdmin
    .from('surveys')
    .upsert({
      user_id: userId,
      role_id: data.role_id,
      current_designation: data.current_designation,
      years_experience: data.years_experience,
      education_level: data.education_level,
      familiarity_scores: data.familiarity_scores,
      learning_goals: data.learning_goals,
      preferred_modality: data.preferred_modality,
      preferred_language: data.preferred_language,
      time_availability: data.time_availability,
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: 'Failed to save survey', code: 'SURVEY_FAILED' });
    return;
  }

  // Update profile with survey data
  if (data.current_designation || data.years_experience || data.education_level || data.preferred_language) {
    await supabaseAdmin.from('profiles').update({
      designation: data.current_designation,
      years_experience: data.years_experience,
      education: data.education_level,
      preferred_language: data.preferred_language,
    }).eq('id', userId);
  }

  // Trigger competency assessment with survey data
  try {
    await fetch(`${process.env.BACKEND_URL || 'http://localhost:3001'}/api/competencies/assess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization || '',
      },
      body: JSON.stringify({
        survey_data: data,
      }),
    });
  } catch (e) {
    console.error('Assessment trigger failed:', e);
  }

  res.json({
    success: true,
    data: survey,
    message: 'Survey saved, AI processing started',
  });
}));

/**
 * GET /api/surveys/me
 */
router.get('/me', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from('surveys')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch survey' });
    return;
  }

  res.json({ success: true, data });
}));

/**
 * GET /api/job-roles
 * 
 * Returns all available job roles for the survey.
 */
router.get('/job-roles', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('job_roles')
    .select('*')
    .order('department', { ascending: true });

  if (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch job roles' });
    return;
  }

  res.json({ success: true, data });
}));

export default router;