/**
 * AI Routes
 * 
 * Integrates with the AI service for:
 * - Multilingual chat (RAG-powered)
 * - Quiz generation from documents
 * 
 * Why: Provides AI-powered features like chatbot, quiz generation, and more.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8001').replace(/\/+$/, '');
const AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY || '';

/**
 * Validation schemas
 */
const chatSchema = z.object({
  message: z.string().min(1),
  course_id: z.string().optional(),
  user_id: z.string(),
  language: z.string().default('en'),
});

const quizGenerateSchema = z.object({
  question_count: z.number().min(5).max(50).default(10),
  bloom_levels: z.array(z.string()).default(['remember', 'understand', 'apply']),
  difficulty: z.number().min(-3).max(3).default(0),
  document_text: z.string().optional(),
});

/**
 * POST /api/ai/chat
 * 
 * Multilingual RAG-powered chat for learning support.
 * 
 * Why: Provides real-time AI tutor assistance with course-contextual responses.
 */
router.post('/chat', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { message, course_id, user_id, language } = chatSchema.parse(req.body);

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/chat/multilingual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        message,
        course_id,
        user_id,
        voice_mode: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json() as any;
    res.json({
      success: true,
      data: {
        answer: data.answer,
        language: data.language,
        sources: data.sources || [],
        audio_url: data.audio_url || null,
      },
    });
  } catch (error: any) {
    console.error('AI chat error:', error);
    
    // Return a fallback response if AI service is unavailable
    res.json({
      success: true,
      data: {
        answer: `I understand you're asking about: "${message}". The AI service is currently unavailable, but I can help you find relevant courses on this topic. Please try again later or browse our course catalog.`,
        language: 'en',
        sources: [],
        audio_url: null,
      },
    });
  }
}));

/**
 * POST /api/ai/quiz/generate
 * 
 * Generate quiz questions from text or competencies.
 * 
 * Why: Allows trainers to auto-generate assessments from course materials.
 */
router.post('/quiz/generate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { question_count, bloom_levels, difficulty, document_text } = quizGenerateSchema.parse(req.body);

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/quiz/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        question_count,
        bloom_levels,
        difficulty,
        document_text,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json() as any;
    res.json({
      success: true,
      data: {
        questions: normalizeQuestions(data?.questions || data?.data?.questions || []),
        metadata: data?.metadata || { question_count, bloom_levels, difficulty },
      },
    });
  } catch (error: any) {
    console.error('AI quiz generation error:', error);
    const fallbackQuestions = buildFallbackQuiz(question_count, bloom_levels, difficulty, document_text || 'government training and public policy');
    res.json({
      success: true,
      data: {
        questions: fallbackQuestions,
        metadata: {
          question_count,
          bloom_levels,
          difficulty,
          source: 'fallback',
          generated_at: new Date().toISOString(),
        },
      },
    });
  }
}));

function normalizeQuestions(questions: any[]): any[] {
  if (!Array.isArray(questions)) return [];

  return questions
    .filter(Boolean)
    .map((q: any, idx: number) => {
      const rawOptions = Array.isArray(q?.options) ? q.options : [];
      const options = rawOptions.filter((opt: any) => typeof opt === 'string' && opt.trim().length > 0).slice(0, 4);
      const padded = [...options, ...Array.from({ length: Math.max(0, 4 - options.length) }, (_, i) => `Option ${i + 1}`)].slice(0, 4);
      const correctIndex = Number.isInteger(q?.correct_answer) ? q.correct_answer : 0;

      return {
        id: String(q?.id ?? `q-${idx + 1}`),
        text: String(q?.text ?? `Question ${idx + 1}`),
        options: padded.map((opt: string) => String(opt)),
        correct_answer: Math.max(0, Math.min(padded.length - 1, correctIndex)),
        bloom_level: String(q?.bloom_level ?? 'understand'),
        difficulty: Number(q?.difficulty ?? 0),
        explanation: String(q?.explanation ?? 'This question is based on the supplied learning material.'),
        language: String(q?.language ?? 'en'),
      };
    })
    .filter((q) => q.text && q.options.length === 4);
}

function buildFallbackQuiz(questionCount: number, bloomLevels: string[], difficulty: number, sourceText?: string) {
  const source = (sourceText || 'Government training in public policy, statistics and digital governance').split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const bloom = bloomLevels?.length ? bloomLevels : ['remember', 'understand', 'apply'];

  return Array.from({ length: Math.max(1, Math.min(questionCount, 10)) }, (_, idx) => {
    const base = source[idx % source.length] || 'The goal of modern public administration is to improve evidence-based decision making.';
    const correct = idx % 4;
    const options = [
      `A practical response supported by ${base.slice(0, 24)}`,
      `A general statement that is not directly supported by the source`,
      `A distractor with weak relevance to the concept`,
      `A statement that does not match the core idea`,
    ];

    return {
      id: `fallback-${idx + 1}`,
      text: `Which option best reflects the key idea in the source material: "${base.slice(0, 120)}"?`,
      options,
      correct_answer: correct,
      bloom_level: bloom[idx % bloom.length],
      difficulty,
      explanation: 'This option aligns most closely with the source material and the main learning objective.',
      language: 'en',
    };
  });
}

/**
 * POST /api/ai/assess
 * 
 * AI-powered competency assessment.
 * 
 * Why: Provides baseline competency scores based on user profile.
 */
router.post('/assess', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { designation, department, years_experience, education, current_assignment } = req.body;

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/assess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        user_id: req.user!.id,
        designation,
        department,
        years_experience,
        education,
        current_assignment,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json() as any;
    res.json({
      success: true,
      data: {
        competencies: data.competencies,
        baseline_scores: data.baseline_scores,
        assessment_summary: data.assessment_summary,
      },
    });
  } catch (error: any) {
    console.error('AI assessment error:', error);
    res.status(500).json({
      success: false,
      error: `AI service error: ${error.message}. Check that AI service is running on ${AI_SERVICE_URL} and GOOGLE_API_KEY is valid.`,
    });
  }
}));

/**
 * POST /api/ai/recommend
 * 
 * AI-powered course recommendations.
 * 
 * Why: Provides personalized course recommendations based on skill gaps.
 */
router.post('/recommend', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { skill_gaps } = req.body;

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/recommend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        user_id: req.user!.id,
        skill_gaps,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json() as any;
    res.json({
      success: true,
      data: {
        recommendations: data.recommendations,
        priority_reasons: data.priority_reasons,
      },
    });
  } catch (error: any) {
    console.error('AI recommendation error:', error);
    res.status(500).json({
      success: false,
      error: `AI service error: ${error.message}. Check that AI service is running on ${AI_SERVICE_URL} and GOOGLE_API_KEY is valid.`,
    });
  }
}));

/**
 * POST /api/ai/translate
 * 
 * Site-wide UI translation via Sarvam AI with English fallback.
 * Why: The globe button in the layout needs to actually translate page text,
 * not just set <html lang>. This proxies to Sarvam (or returns original on failure).
 */
router.post('/translate', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { text, target_language = 'hi', source_language = 'en' } = req.body as { text: string; target_language?: string; source_language?: string };
  if (!text || typeof text !== 'string') {
    res.status(400).json({ success: false, error: 'text is required' });
    return;
  }
  if (target_language === source_language || target_language === 'en') {
    res.json({ success: true, data: { translated_text: text, source_language, target_language } });
    return;
  }
  const sarvamKey = process.env.SARVAM_API_KEY;
  if (!sarvamKey) {
    // No Sarvam configured — return original so UI doesn't break
    res.json({ success: true, data: { translated_text: text, source_language, target_language, note: 'SARVAM_API_KEY not set — no translation' } });
    return;
  }
  try {
    const r = await fetch('https://api.sarvam.ai/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sarvamKey}` },
      body: JSON.stringify({
        input: text,
        source_language_code: source_language,
        target_language_code: target_language,
        speaker_gender: 'Female',
        mode: 'formal',
        model: 'mayura:v1',
        enable_preprocessing: true,
      }),
    });
    if (!r.ok) throw new Error(`Sarvam ${r.status}: ${await r.text().then(t=>t.slice(0,200))}`);
    const j = await r.json() as any;
    const translated = j.translated_text || j.output || text;
    res.json({ success: true, data: { translated_text: translated, source_language, target_language } });
  } catch (err: any) {
    console.error('Translate error:', err);
    res.json({ success: true, data: { translated_text: text, source_language, target_language, warning: err.message } });
  }
}));

export default router;