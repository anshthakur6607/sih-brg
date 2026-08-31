/**
 * Certificate Routes
 * 
 * Handles certificate operations including:
 * - Listing user certificates
 * - Verifying certificates
 * - Generating new certificates
 * 
 * Why: Certificates are the proof of completion. These routes
 * manage certificate issuance and verification for the platform.
 */

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/certificates
 * 
 * Returns all certificates for the current user.
 * 
 * Why: Users need to see their earned certificates.
 */
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: certificates, error } = await supabaseAdmin
    .from('certificates')
    .select(`
      *,
      course:courses(id, title, provider)
    `)
    .eq('user_id', userId)
    .order('issue_date', { ascending: false });

  if (error) {
    console.error('Certificate fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch certificates',
      code: 'FETCH_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: certificates || [],
  });
}));

/**
 * GET /api/certificates/:id
 * 
 * Returns detailed certificate information.
 * 
 * Why: Users need full certificate details for display/printing.
 */
router.get('/:id', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const { data: certificate, error } = await supabaseAdmin
    .from('certificates')
    .select(`
      *,
      course:courses(*),
      user:profiles(id, full_name, designation, department)
    `)
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !certificate) {
    throw new NotFoundError('Certificate');
  }

  res.json({
    success: true,
    data: certificate,
  });
}));

/**
 * GET /api/certificates/verify/:code
 * 
 * Verifies a certificate by its unique verification code.
 * Public endpoint for external verification.
 * 
 * Why: Allows anyone to verify a certificate's authenticity
 * using the verification code printed on the certificate.
 */
router.get('/verify/:code', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { code } = req.params;

  const { data: certificate, error } = await supabaseAdmin
    .from('certificates')
    .select(`
      *,
      course:courses(title, provider),
      user:profiles(full_name, designation, department)
    `)
    .eq('verification_code', code)
    .single();

  if (error || !certificate) {
    res.status(404).json({
      success: false,
      error: 'Certificate not found or invalid',
      code: 'INVALID_CERTIFICATE',
    });
    return;
  }

  res.json({
    success: true,
    data: {
      verified: true,
      certificate: {
        id: certificate.id,
        recipient_name: certificate.user?.full_name,
        designation: certificate.user?.designation,
        department: certificate.user?.department,
        course_title: certificate.course?.title,
        provider: certificate.course?.provider,
        auto_score: certificate.auto_score,
        verified_score: certificate.verified_score,
        signed_by: certificate.signed_by_admin,
        issue_date: certificate.issue_date,
      },
    },
  });
}));

/**
 * POST /api/certificates
 * 
 * Creates a new certificate for a completed course.
 * 
 * Why: Called after an assessment is approved by admin.
 * Generates unique verification code and stores certificate.
 */
router.post('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { attempt_id } = req.body;

  if (!attempt_id) {
    res.status(400).json({
      success: false,
      error: 'attempt_id is required',
      code: 'MISSING_ATTEMPT',
    });
    return;
  }

  // Get the approved assessment attempt
  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('assessment_attempts')
    .select(`
      *,
      course:courses(*)
    `)
    .eq('id', attempt_id)
    .eq('user_id', userId)
    .eq('status', 'approved')
    .single();

  if (!attempt) {
    res.status(400).json({
      success: false,
      error: 'No approved assessment found for this attempt',
      code: 'NO_APPROVED_ASSESSMENT',
    });
    return;
  }

  // Check if certificate already exists
  const { data: existing } = await supabaseAdmin
    .from('certificates')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', attempt.course_id)
    .single();

  if (existing) {
    res.status(409).json({
      success: false,
      error: 'Certificate already issued for this course',
      code: 'CERTIFICATE_EXISTS',
    });
    return;
  }

  // Generate unique verification code
  const verificationCode = generateVerificationCode();

  // Get admin who verified the assessment
  const { data: review } = await supabaseAdmin
    .from('assessment_reviews')
    .select('verified_by, final_verified_score')
    .eq('attempt_id', attempt_id)
    .single();

  // Create certificate
  const { data: certificate, error: certError } = await supabaseAdmin
    .from('certificates')
    .insert({
      user_id: userId,
      course_id: attempt.course_id,
      verification_code: verificationCode,
      auto_score: attempt.auto_score,
      verified_score: review?.final_verified_score || attempt.auto_score,
      signed_by_admin: review?.verified_by || 'System',
    })
    .select()
    .single();

  if (certError) {
    console.error('Certificate creation error:', certError);
    res.status(500).json({
      success: false,
      error: 'Failed to create certificate',
      code: 'CREATION_FAILED',
    });
    return;
  }

  res.status(201).json({
    success: true,
    data: certificate,
    message: 'Certificate issued successfully',
  });
}));

/**
 * Helper: Generate unique verification code
 * Format: SU-YYYYMMDD-XXXXXXXX (16 chars)
 */
function generateVerificationCode(): string {
  const date = new Date();
  const dateStr = date.getFullYear().toString() +
    (date.getMonth() + 1).toString().padStart(2, '0') +
    date.getDate().toString().padStart(2, '0');
  
  const randomPart = uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();
  
  return `SU-${dateStr}-${randomPart}`;
}

export default router;