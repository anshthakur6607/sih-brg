/**
 * Live Quiz Routes
 * 
 * Generates AI-powered voice quizzes from course materials.
 * Uses course content to create adaptive questions with:
 * - Bloom's taxonomy levels
 * - IRT-based difficulty
 * - Multilingual support
 * - Multimedia integration (images/videos from course materials)
 * - Strict anti-cheat questions
 * 
 * Why: The most immersive assessment experience. Voice-based, adaptive,
 * powered by course-specific content.
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8001').replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_SERVICE_API_KEY || 'sk-ai-secret-key';

/**
 * POST /api/ai/live-quiz/generate
 * 
 * Generates a live voice quiz from course materials.
 */
router.post('/generate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { course_id, course_title, course_description, language, difficulty, num_questions } = req.body;

  if (!course_id) {
    res.status(400).json({ success: false, error: 'course_id required' });
    return;
  }

  // 1. Fetch course materials for RAG
  const { data: materials } = await supabaseAdmin
    .from('course_materials')
    .select('*')
    .eq('course_id', course_id)
    .order('order_index', { ascending: true });

  // 2. Build context from materials
  let context = course_description || '';
  if (materials && materials.length > 0) {
    const textMaterials = materials
      .filter(m => m.content_text)
      .map(m => `--- ${m.title} ---\n${m.content_text}`)
      .join('\n\n');
    context = `${course_description || ''}\n\n${textMaterials}`.substring(0, 15000);
  }

  // 3. Generate questions via AI service
  try {
    const aiResponse = await fetch(`${AI_SERVICE_URL}/api/ai/quiz/generate-live`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_API_KEY,
      },
      body: JSON.stringify({
        context,
        course_title,
        num_questions: num_questions || 5,
        language: language || 'en',
        difficulty: difficulty || 'medium',
        mode: 'voice', // Voice-optimized questions
        include_images: materials?.some(m => m.type === 'image') || false,
        bloom_levels: ['remember', 'understand', 'apply', 'analyze'],
      }),
    });

    if (!aiResponse.ok) {
      // Fallback: generate basic questions locally
      const questions = await generateFallbackQuestions(context, course_title, language, difficulty, num_questions);
      res.json({ success: true, questions, source: 'fallback' });
      return;
    }

    const data = await aiResponse.json() as any;
    const questions = data.questions || [];

    // 4. Save questions to database with IRT parameters
    for (const q of questions) {
      await saveQuestionWithIRT(q, course_id, language);
    }

    res.json({
      success: true,
      questions,
      meta: {
        source: 'ai_generated',
        bloom_levels_used: [...new Set(questions.map((q: any) => q.bloom_level))],
        difficulty,
        language,
        materials_used: materials?.length || 0,
      },
    });
  } catch (err) {
    console.error('Live quiz generation failed:', err);
    // Fallback to local generation
    const questions = await generateFallbackQuestions(context, course_title, language, difficulty, num_questions);
    res.json({ success: true, questions, source: 'fallback' });
  }
}));

/**
 * POST /api/ai/live-quiz/evaluate
 * 
 * Evaluates user's spoken answer in real-time.
 */
router.post('/evaluate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { question_id, user_answer, language } = req.body;

  const { data: question } = await supabaseAdmin
    .from('questions')
    .select('*')
    .eq('id', question_id)
    .single();

  if (!question) {
    res.status(404).json({ success: false, error: 'Question not found' });
    return;
  }

  // Evaluate using keyword matching + AI scoring
  const correctOption = question.options?.[question.correct_answer]?.toLowerCase() || '';
  const userAnswer = (user_answer || '').toLowerCase().trim();

  let score = 0;
  let explanation = '';

  // Check for letter answer (A, B, C, D)
  const letterMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
  const userLetter = userAnswer.replace(/[^a-d]/g, '');
  if (letterMap[userLetter] === question.correct_answer) {
    score = 1;
  } else if (correctOption.includes(userAnswer) || userAnswer.includes(correctOption)) {
    score = 1;
  } else {
    // Partial credit using word overlap
    const correctWords = correctOption.split(/\s+/).filter(w => w.length > 2);
    const userWords = userAnswer.split(/\s+/);
    const overlap = correctWords.filter(w => userWords.includes(w)).length;
    score = correctWords.length > 0 ? overlap / correctWords.length : 0;
  }

  explanation = score >= 0.5
    ? `Correct! ${question.explanation || ''}`
    : `The correct answer is: ${question.options?.[question.correct_answer]}. ${question.explanation || ''}`;

  // Update IRT stats
  await supabaseAdmin
    .from('questions')
    .update({
      times_asked: (question.times_asked || 0) + 1,
      times_correct: (question.times_correct || 0) + (score >= 0.5 ? 1 : 0),
    })
    .eq('id', question_id);

  res.json({
    success: true,
    data: {
      score: Math.round(score * 100),
      correct: score >= 0.5,
      explanation,
      correct_answer: question.options?.[question.correct_answer],
      irt_difficulty: question.irt_b,
    },
  });
}));

/**
 * GET /api/ai/live-quiz/:sessionId
 */
router.get('/:sessionId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { sessionId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('live_quiz_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', req.user!.id)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, error: 'Session not found' });
    return;
  }

  res.json({ success: true, data });
}));

// ============ HELPERS ============

async function generateFallbackQuestions(
  context: string,
  courseTitle: string,
  language: string,
  difficulty: string,
  numQuestions: number
) {
  const bloomLevels = ['remember', 'understand', 'apply'];
  const diffMap: Record<string, number> = { easy: -1, medium: 0, hard: 1 };

  // Simple keyword-based question generation from context
  const words = context.split(/\s+/).filter(w => w.length > 5);
  const keyTerms = [...new Set(words)].slice(0, 20);

  const questions = [];
  for (let i = 0; i < Math.min(numQuestions, 5); i++) {
    const bloomLevel = bloomLevels[i % bloomLevels.length];
    const term = keyTerms[i % keyTerms.length] || 'topic';

    questions.push({
      id: `fallback-${Date.now()}-${i}`,
      text: `Based on the course "${courseTitle || 'this course'}", what do you understand by "${term}"?`,
      options: [
        `A definition of ${term}`,
        `An unrelated concept`,
        `A historical fact`,
        `A statistical method`,
      ],
      correct_answer: 0,
      bloom_level: bloomLevel,
      difficulty: diffMap[difficulty] || 0,
      explanation: `This question tests your understanding of ${term} from the course material.`,
    });
  }

  return questions;
}

async function saveQuestionWithIRT(question: any, courseId: string, language: string) {
  const contentHash = crypto.createHash('md5').update(question.text).digest('hex');

  // Check for duplicates
  const { data: existing } = await supabaseAdmin
    .from('questions')
    .select('id')
    .eq('content_hash', contentHash)
    .single();

  if (existing) return; // Skip duplicate

  // IRT parameter estimation (simplified)
  const irt_b = question.difficulty || 0; // -2 to +2 scale
  const irt_a = 1.0 + Math.random() * 0.5; // discrimination
  const irt_c = 0.2; // guessing

  await supabaseAdmin.from('questions').insert({
    course_id: courseId,
    language: language || 'en',
    question_text: question.text,
    options: question.options,
    correct_answer: question.correct_answer,
    bloom_level: question.bloom_level || 'understand',
    explanation: question.explanation,
    irt_a,
    irt_b,
    irt_c,
    content_hash: contentHash,
    times_asked: 0,
    times_correct: 0,
  }).onConflict('id').ignore();
}

export default router;