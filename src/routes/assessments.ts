/**
 * Assessment Routes
 * 
 * Handles assessment operations including:
 * - Starting assessment attempts
 * - Submitting answers
 * - Recording anti-cheat telemetry
 * - Viewing attempt history
 * - AI-powered quiz generation
 * 
 * Why: Assessments are how we measure learning progress and competency.
 * These routes manage the full assessment lifecycle with security features.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { submissionRateLimiter } from '../middleware/rateLimiter.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/**
 * Validation schemas
 */
const submitAnswerSchema = z.object({
  // AI-generated exam questions use stable q_* IDs rather than database UUIDs.
  question_id: z.string().min(1),
  answer_index: z.number().int().min(0).max(3),
  time_taken_seconds: z.number().min(0).default(0),
  correct_answer: z.number().int().min(0).max(3).optional(),
});

const submitAssessmentSchema = z.object({
  attempt_id: z.string().uuid(),
  answers: z.array(submitAnswerSchema),
  tab_switch_count: z.number().min(0),
  fullscreen_exits: z.number().min(0),
  time_taken_seconds: z.number().min(0),
});

const generateQuizSchema = z.object({
  course_id: z.string().uuid().optional(),
  competency_ids: z.array(z.string().uuid()).optional(),
  question_count: z.number().min(5).max(50).default(10),
  bloom_levels: z.array(z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'])).optional(),
  difficulty: z.number().min(-3).max(3).default(0),
  document_text: z.string().optional(),
});

/**
 * GET /api/assessments
 * 
 * Returns assessment history for the current user.
 * 
 * Why: Users need to see their past assessment attempts and scores.
 */
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { page = 1, page_size = 20 } = req.query;

  const from = (Number(page) - 1) * Number(page_size);
  const to = from + Number(page_size) - 1;

  const { data: attempts, error, count } = await supabaseAdmin
    .from('assessment_attempts')
    .select(`
      *,
      course:courses(id, title, source)
    `, { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Assessment fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assessments',
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
 * GET /api/assessments/:id
 * 
 * Returns detailed assessment attempt information.
 * 
 * Why: Users need to review their assessment details and telemetry.
 */
router.get('/:id', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const { data: attempt, error } = await supabaseAdmin
    .from('assessment_attempts')
    .select(`
      *,
      course:courses(*),
      review:assessment_reviews(*)
    `)
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !attempt) {
    throw new NotFoundError('Assessment');
  }

  res.json({
    success: true,
    data: attempt,
  });
}));

/**
 * POST /api/assessments/start
 * 
 * Starts a new assessment attempt.
 * Creates a new attempt record and returns the first question.
 * 
 * Why: Initiates the assessment process and enables anti-cheat tracking.
 */
router.post('/start', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { course_id } = req.body;

  if (!course_id) {
    res.status(400).json({
      success: false,
      error: 'course_id is required',
      code: 'MISSING_COURSE',
    });
    return;
  }

  // Verify course exists
  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('id, title, target_competencies')
    .eq('id', course_id)
    .single();

  if (!course) {
    throw new NotFoundError('Course');
  }

  // Exams are gatekeeper assessments: the learner must finish the course
  // before an attempt can be created.
  const { data: enrollment } = await supabaseAdmin
    .from('course_enrollments')
    .select('status, progress_percentage')
    .eq('user_id', userId)
    .eq('course_id', course_id)
    .maybeSingle();
  if (!enrollment || enrollment.status !== 'completed' || enrollment.progress_percentage < 100) {
    res.status(403).json({
      success: false,
      error: 'Complete the course before starting the exam',
      code: 'COURSE_NOT_COMPLETED',
    });
    return;
  }

  // Retake support: reuse the existing pending attempt instead of stacking
  // duplicates every time the learner re-opens the exam.
  const { data: pendingAttempt } = await supabaseAdmin
    .from('assessment_attempts')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', course_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let attemptId: string;
  if (pendingAttempt?.id) {
    attemptId = pendingAttempt.id;
  } else {
    // Create new assessment attempt
    const { data: attempt, error } = await supabaseAdmin
      .from('assessment_attempts')
      .insert({
        user_id: userId,
        course_id,
        status: 'pending',
        passed: false,
        tab_switch_count: 0,
        fullscreen_exits: 0,
        time_taken_seconds: 0,
        telemetry_flags: [],
      })
      .select()
      .single();

    if (error || !attempt) {
      console.error('Assessment start error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start assessment',
        code: 'START_FAILED',
      });
      return;
    }
    attemptId = attempt.id;
  }

  // Fetch seed questions for course competencies (UUID entries only —
  // target_competencies may hold plain names in seed rows; the exam page
  // generates fresh AI questions anyway, so never fail the start here).
  const compIds = (course.target_competencies || []).filter((v: unknown) =>
    /^[0-9a-f-]{36}$/i.test(String(v))
  );
  let questions: unknown[] = [];
  if (compIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('assessment_questions')
      .select('*')
      .in('competency_id', compIds)
      .limit(20);
    questions = data || [];
  }

  res.status(pendingAttempt ? 200 : 201).json({
    success: true,
    data: {
      attempt_id: attemptId,
      questions,
      start_time: new Date().toISOString(),
      resumed: !!pendingAttempt,
    },
    message: pendingAttempt ? 'Resumed pending assessment' : 'Assessment started',
  });
}));

/**
 * POST /api/assessments/telemetry
 * 
 * Records anti-cheat telemetry during an assessment.
 * 
 * Why: Tracks user behavior to detect cheating attempts.
 * Records tab switches, fullscreen exits, copy attempts, etc.
 */
router.post('/telemetry', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { attempt_id, event_type, event_data } = req.body;

  if (!attempt_id || !event_type) {
    res.status(400).json({
      success: false,
      error: 'attempt_id and event_type are required',
      code: 'MISSING_PARAMS',
    });
    return;
  }

  // Get current attempt
  const { data: attempt } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*')
    .eq('id', attempt_id)
    .eq('user_id', userId)
    .single();

  if (!attempt) {
    throw new NotFoundError('Assessment attempt');
  }

  // Update telemetry counters
  let updates: Record<string, unknown> = {};
  const telemetryFlags = attempt.telemetry_flags || [];

  switch (event_type) {
    case 'tab_switch':
      updates.tab_switch_count = attempt.tab_switch_count + 1;
      telemetryFlags.push(`tab_switch_at_${Date.now()}`);
      break;
    case 'fullscreen_exit':
      updates.fullscreen_exits = attempt.fullscreen_exits + 1;
      telemetryFlags.push(`fullscreen_exit_at_${Date.now()}`);
      break;
    case 'copy_attempt':
      telemetryFlags.push('copy_attempt_detected');
      break;
    case 'paste_attempt':
      telemetryFlags.push('paste_attempt_detected');
      break;
    case 'shortcut_used':
      telemetryFlags.push(`shortcut_${event_data?.shortcut}`);
      break;
    case 'visibility_change':
      telemetryFlags.push(`visibility_hidden_at_${Date.now()}`);
      break;
  }

  // Add warning flags if thresholds exceeded
  if ((updates.tab_switch_count as number) > 5) {
    telemetryFlags.push('EXCESSIVE_TAB_SWITCHES');
  }
  if ((updates.fullscreen_exits as number) > 2) {
    telemetryFlags.push('FULLSCREEN_VIOLATIONS');
  }

  updates.telemetry_flags = telemetryFlags;

  // Update attempt
  const { error } = await supabaseAdmin
    .from('assessment_attempts')
    .update(updates)
    .eq('id', attempt_id);

  if (error) {
    console.error('Telemetry update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record telemetry',
      code: 'TELEMETRY_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Telemetry recorded',
    warning: (updates.tab_switch_count as number) > 5 || (updates.fullscreen_exits as number) > 2
      ? 'Warning: Excessive violations detected'
      : null,
  });
}));

/**
 * POST /api/assessments/submit
 * 
 * Submits an assessment attempt and calculates the score.
 * 
 * Why: Finalizes the assessment, grades answers, and updates competency scores.
 */
router.post('/submit', submissionRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  
  // Validate request
  const { attempt_id, answers, tab_switch_count, fullscreen_exits, time_taken_seconds } =
    submitAssessmentSchema.parse(req.body);

  // Get attempt
  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*, course:courses(*)')
    .eq('id', attempt_id)
    .eq('user_id', userId)
    .single();

  if (!attempt) {
    throw new NotFoundError('Assessment attempt');
  }

  // Grade generated questions against the answer key returned by the AI
  // service. The answer key is never rendered while the exam is in progress.
  let correctAnswers = 0;
  const gradedAnswers = answers.map((answer) => {
    const isCorrect = answer.correct_answer !== undefined
      ? answer.answer_index === answer.correct_answer
      : false;
    if (isCorrect) correctAnswers++;
    return { ...answer, is_correct: isCorrect };
  });

  const totalQuestions = answers.length;
  const autoScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
  const passed = autoScore >= 70; // 70% passing threshold

  // Update attempt with results
  const { data: updatedAttempt, error: updateError } = await supabaseAdmin
    .from('assessment_attempts')
    .update({
      auto_score: autoScore,
      passed,
      tab_switch_count,
      fullscreen_exits,
      time_taken_seconds,
      // Every attempt must be verified by an admin, including passing scores.
      status: 'pending',
    })
    .eq('id', attempt_id)
    .select()
    .single();

  if (updateError) {
    console.error('Submission error:', updateError);
    res.status(500).json({
      success: false,
      error: 'Failed to submit assessment',
      code: 'SUBMISSION_FAILED',
    });
    return;
  }

  res.json({
    success: true,
    data: {
      attempt: updatedAttempt,
      results: {
        correct: correctAnswers,
        total: totalQuestions,
        score: autoScore,
        passed,
      },
      graded_answers: gradedAnswers,
    },
      message: 'Exam submitted. An administrator must verify the marks before they are locked.',
  });
}));

/**
 * GET /api/assessments/quiz/generate
 * 
 * Generates AI-powered quiz questions from course materials.
 * 
 * Why: Allows trainers to auto-generate assessments from documents.
 * This endpoint triggers the AI service to create questions.
 */
router.post('/quiz/generate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  
  // Validate request
  const { question_count, bloom_levels, difficulty, document_text, competency_ids } =
    generateQuizSchema.parse(req.body);

  // In production, this would call the AI service
  // For now, return mock questions
  const mockQuestions = generateMockQuestions(
    question_count,
    bloom_levels || ['remember', 'understand', 'apply'],
    difficulty
  );

  res.json({
    success: true,
    data: {
      questions: mockQuestions,
      metadata: {
        question_count: mockQuestions.length,
        bloom_levels: bloom_levels || ['remember', 'understand', 'apply'],
        difficulty,
        generated_at: new Date().toISOString(),
        source: document_text ? 'document' : 'competency',
      },
    },
    message: 'Quiz generated successfully',
  });
}));

/**
 * Helper: Get current competency score
 */
async function getCurrentScore(userId: string, competencyId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('user_competency_scores')
    .select('current_score')
    .eq('user_id', userId)
    .eq('competency_id', competencyId)
    .single();

  return data?.current_score || 1.0;
}

/**
 * Helper: Generate mock questions for demo
 */
function generateMockQuestions(
  count: number,
  bloomLevels: string[],
  difficulty: number
): Record<string, unknown>[] {
  const questions = [];
  const sampleTopics = [
    'Data Collection Methods',
    'Statistical Sampling',
    'Survey Design',
    'Data Analysis',
    'Report Writing',
  ];

  for (let i = 0; i < count; i++) {
    questions.push({
      id: `q_${Date.now()}_${i}`,
      text: `Sample question ${i + 1} about ${sampleTopics[i % sampleTopics.length]}?`,
      options: [
        `Option A for question ${i + 1}`,
        `Option B for question ${i + 1}`,
        `Option C for question ${i + 1}`,
        `Option D for question ${i + 1}`,
      ],
      correct_answer: Math.floor(Math.random() * 4),
      bloom_level: bloomLevels[i % bloomLevels.length],
      difficulty: difficulty + (Math.random() - 0.5),
      explanation: `This is the explanation for question ${i + 1}`,
    });
  }

  return questions;
}

export default router;
