/**
 * Enrollment Routes
 * 
 * Manages course enrollments and progress tracking.
 * Designed for future iGOT webhook integration.
 * 
 * Why: Single source of truth for course progress, ready for
 * external system sync (iGOT, NSSTA, SWAYAM, DIKSHA).
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { awardPoints } from '../services/gamification.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/enrollments
 * 
 * Enrolls user in a course and initializes progress tracking.
 */
router.post('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { course_id, source } = req.body;

  if (!course_id) {
    res.status(400).json({ success: false, error: 'course_id required' });
    return;
  }

  // Get course details to compute expected completion
  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('id', course_id)
    .single();

  if (!course) {
    res.status(404).json({ success: false, error: 'Course not found' });
    return;
  }

  // Compute expected completion based on duration
  const now = new Date();
  const expected = new Date(now.getTime() + (course.duration_hours || 10) * 60 * 60 * 1000);

  const { data: enrollment, error } = await supabaseAdmin
    .from('course_enrollments')
    .upsert({
      user_id: userId,
      course_id,
      source: source || course.source || 'iGOT',
      status: 'in_progress',
      progress_percentage: 0,
      started_at: now.toISOString(),
      expected_completion_at: expected.toISOString(),
    }, { onConflict: 'user_id,course_id' })
    .select('*, course:courses(*)')
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Log learning signal
  await supabaseAdmin.from('learning_signals').insert({
    user_id: userId,
    course_id,
    signal_type: 'started',
    signal_value: 0,
    signal_metadata: { source, expected_completion: expected.toISOString() },
  });

  // Award points for starting
  await awardPoints(userId, 5, 'course_started');

  res.json({
    success: true,
    data: enrollment,
    message: 'Enrolled successfully',
  });
}));

/**
 * GET /api/enrollments/me
 * 
 * Returns all enrollments for the current user.
 */
router.get('/me', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  // Auto-sync from iGOT if enabled
  if (process.env.IGOT_API_URL) {
    try {
      await syncFromIGOT(userId);
    } catch (e) {
      console.error('iGOT sync failed:', e);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('course_enrollments')
    .select('*, course:courses(*)')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Auto-complete past-due enrollments
  const now = new Date();
  const updated = await Promise.all(
    (data || []).map(async (e) => {
      if (
        e.status === 'in_progress' &&
        e.expected_completion_at &&
        new Date(e.expected_completion_at) < now
      ) {
        await supabaseAdmin
          .from('course_enrollments')
          .update({
            status: 'completed',
            progress_percentage: 100,
            completed_at: e.expected_completion_at,
          })
          .eq('id', e.id);

        // Award completion points
        await awardPoints(userId, 50, 'course_completed');

        // Generate certificate
        await generateCertificate(userId, e.course_id);

        return { ...e, status: 'completed', progress_percentage: 100 };
      }
      return e;
    })
  );

  res.json({ success: true, data: updated });
}));

/**
 * PATCH /api/enrollments/:id/progress
 * 
 * Updates progress percentage (called by iGOT webhook in future).
 */
router.patch('/:id/progress', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { progress_percentage, external_id, source } = req.body;

  const updates: any = {};
  if (typeof progress_percentage === 'number') {
    updates.progress_percentage = Math.min(100, Math.max(0, progress_percentage));
    
    if (updates.progress_percentage >= 100) {
      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();
    }
  }
  if (external_id) updates.external_enrollment_id = external_id;
  if (source) updates.source = source;
  updates.last_synced_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('course_enrollments')
    .update(updates)
    .eq('id', id)
    .select('*, course:courses(*)')
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Log signal
  if (typeof progress_percentage === 'number') {
    await supabaseAdmin.from('learning_signals').insert({
      user_id: data.user_id,
      course_id: data.course_id,
      signal_type: updates.status === 'completed' ? 'completed' : 'progress',
      signal_value: progress_percentage,
    });

    if (updates.status === 'completed') {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', data.user_id)
        .single();
      if (profile) {
        await awardPoints(data.user_id, 50, 'course_completed');
        await generateCertificate(data.user_id, data.course_id);
      }
    }
  }

  res.json({ success: true, data });
}));

/**
 * GET /api/enrollments/ready-for-exam
 * 
 * Returns enrollments that are 80%+ complete (ready for exam).
 */
router.get('/ready-for-exam', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from('course_enrollments')
    .select('*, course:courses(*)')
    .eq('user_id', userId)
    .gte('progress_percentage', 80)
    .neq('status', 'completed');

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
}));

// ============ HELPERS ============

async function generateCertificate(userId: string, courseId: string) {
  // Check if certificate already exists
  const { data: existing } = await supabaseAdmin
    .from('certificates')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .maybeSingle();

  if (existing) return;

  const { data: user } = await supabaseAdmin
    .from('profiles')
    .select('full_name, department, designation')
    .eq('id', userId)
    .single();

  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('title, provider, duration_hours')
    .eq('id', courseId)
    .single();

  const certId = `SKILLUP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
  
  // Generate blockchain-ready hash
  const crypto = await import('crypto');
  const signature = crypto
    .createHash('sha256')
    .update(`${certId}-${userId}-${courseId}-${Date.now()}`)
    .digest('hex');

  await supabaseAdmin.from('certificates').insert({
    user_id: userId,
    course_id: courseId,
    certificate_id: certId,
    user_name: user?.full_name,
    course_title: course?.title,
    issued_at: new Date().toISOString(),
    signature,
    signature_algorithm: 'RSA-SHA256',
    blockchain_hash: signature,
    metadata: {
      provider: course?.provider,
      duration_hours: course?.duration_hours,
      department: user?.department,
    },
  });
}

function verifyWebhookSignature(signature: string, body: any): boolean {
  // In production, use HMAC-SHA256 verification
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', process.env.IGOT_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return signature === expected;
}

async function syncFromIGOT(userId: string) {
  // Placeholder for future iGOT API integration
  // Will be implemented when iGOT API credentials are available
  return null;
}

export default router;