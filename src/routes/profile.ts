/**
 * Profile Routes
 * 
 * Handles user profile management including:
 * - Getting current user profile
 * - Updating profile information
 * - Completing onboarding
 * - Managing competency preferences
 * 
 * Why: Profiles store essential user information for the competency system.
 * These routes allow users to manage their professional details and preferences.
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
const updateProfileSchema = z.object({
  full_name: z.string().min(2).optional(),
  designation: z.string().min(2).optional(),
  department: z.string().min(2).optional(),
  ministry: z.string().optional(),
  organization_level: z.string().optional(),
  current_assignment: z.string().optional(),
  education: z.string().optional(),
  years_experience: z.number().min(0).max(50).optional(),
  preferred_language: z.string().optional(),
  voice_navigation_enabled: z.boolean().optional(),
  consent_given: z.boolean().optional(),
});

const onboardingSchema = updateProfileSchema.extend({
  consent_given: z.literal(true), // Consent is required for onboarding
});

/**
 * GET /api/profile
 * 
 * Returns the current user's complete profile.
 * 
 * Why: Frontend needs profile data for personalization and display.
 */
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    throw new NotFoundError('Profile');
  }

  res.json({
    success: true,
    data: profile,
  });
}));

/**
 * PUT /api/profile
 * 
 * Updates the current user's profile.
 * 
 * Why: Allows users to update their personal and professional information.
 */
router.put('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const userEmail = req.user!.email;
  
  // Validate request body
  const validatedData = updateProfileSchema.parse(req.body);

  const updateData: Record<string, unknown> = {
    ...validatedData,
    updated_at: new Date().toISOString(),
  };

  // Upsert: insert if missing, update if exists
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: userId,
      email: userEmail,
      ...updateData,
    }, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('Profile upsert error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save profile',
      code: 'UPSERT_FAILED',
      details: error.message,
    });
    return;
  }

  res.json({
    success: true,
    data: profile,
    message: 'Profile saved successfully',
  });
}));

/**
 * POST /api/profile/onboarding
 * 
 * Completes the onboarding process.
 * This is the initial profile setup after registration.
 * 
 * Why: Onboarding captures essential data for competency mapping
 * and ensures consent is properly recorded.
 */
router.post('/onboarding', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  
  // Validate request body (consent required)
  const validatedData = onboardingSchema.parse(req.body);

  // Update profile with onboarding data
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update({
      ...validatedData,
      consent_timestamp: validatedData.consent_given ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('Onboarding error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete onboarding',
      code: 'ONBOARDING_FAILED',
    });
    return;
  }

  // Initialize default competency scores based on designation
  // This is a simplified version - AI will do proper mapping
  await initializeCompetencyScores(userId, validatedData.department, validatedData.designation);

  res.json({
    success: true,
    data: profile,
    message: 'Onboarding completed successfully',
  });
}));

/**
 * GET /api/profile/competencies
 * 
 * Returns the user's competency scores.
 * 
 * Why: Frontend needs competency data for dashboard and skill-gap display.
 */
router.get('/competencies', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

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
    data: scores || [],
  });
}));

/**
 * PUT /api/profile/competencies/:competencyId
 * 
 * Updates a specific competency score.
 * 
 * Why: Allows manual adjustment of competency levels.
 */
router.put('/competencies/:competencyId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { competencyId } = req.params;
  const { current_score, required_score } = req.body;

  // Validate scores
  if (current_score !== undefined && (current_score < 0 || current_score > 5)) {
    res.status(400).json({
      success: false,
      error: 'Current score must be between 0 and 5',
      code: 'INVALID_SCORE',
    });
    return;
  }

  // Upsert competency score
  const { data: score, error } = await supabaseAdmin
    .from('user_competency_scores')
    .upsert({
      user_id: userId,
      competency_id: competencyId,
      current_score: current_score ?? 0,
      required_score: required_score ?? 4,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,competency_id',
    })
    .select()
    .single();

  if (error) {
    console.error('Competency update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update competency',
      code: 'UPDATE_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: score,
    message: 'Competency score updated',
  });
}));

/**
 * Helper: Initialize default competency scores based on department/designation
 * 
 * This creates baseline competency scores when a user completes onboarding.
 * In production, this would use AI to analyze the designation and department
 * to set appropriate baseline scores.
 */
async function initializeCompetencyScores(
  userId: string, 
  department: string, 
  designation: string
): Promise<void> {
  // Get all competencies
  const { data: competencies } = await supabaseAdmin
    .from('competencies')
    .select('id, domain_id');

  if (!competencies || competencies.length === 0) {
    console.warn('No competencies found to initialize');
    return;
  }

  // Default required score for all competencies
  const requiredScore = 4.0;

  // Create default scores (will be adjusted by AI assessment later)
  const scores = competencies.map((comp) => ({
    user_id: userId,
    competency_id: comp.id,
    current_score: 1.0, // Start with basic level
    required_score: requiredScore,
    updated_at: new Date().toISOString(),
  }));

  // Batch insert
  const { error } = await supabaseAdmin
    .from('user_competency_scores')
    .upsert(scores, { onConflict: 'user_id,competency_id' });

  if (error) {
    console.error('Failed to initialize competency scores:', error);
  }
}

export default router;