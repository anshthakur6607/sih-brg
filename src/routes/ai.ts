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
import { supabaseAdmin } from '../lib/supabase.js';
import multer from 'multer';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Keep this aligned with the root dev command and ai-service default port.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY || '';

/**
 * Validation schemas
 */
const chatSchema = z.object({
  message: z.string().min(1),
  course_id: z.string().optional(),
  user_id: z.string(),
  language: z.string().default('en'),
  conversation_history: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
});

const quizGenerateSchema = z.object({
  course_id: z.string().uuid().optional(),
  question_count: z.number().min(5).max(50).default(10),
  bloom_levels: z.array(z.string()).default(['remember', 'understand', 'apply']),
  difficulty: z.number().min(-3).max(3).default(0),
  document_text: z.string().optional(),
  language: z.string().default('en'),
  check_duplicates: z.boolean().optional(),
  irt_calibration: z.boolean().optional(),
  adaptive: z.boolean().optional(),
  previous_answers: z.array(z.object({ question_id: z.string(), selected_option: z.number().int().min(0).max(3) })).optional(),
});

/**
 * POST /api/ai/chat
 * 
 * Multilingual RAG-powered chat for learning support.
 * 
 * Why: Provides real-time AI tutor assistance with course-contextual responses.
 */
router.post('/chat', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { message, course_id, user_id, language, conversation_history } = chatSchema.parse(req.body);

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
        conversation_history: conversation_history || [],
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
  const request = quizGenerateSchema.parse(req.body);
  let documentText = request.document_text || '';

  // Fetch the complete material context on the server. The browser must not
  // be responsible for reading/truncating PDF study material or bypassing RAG.
  if (request.course_id) {
    const { data: materials, error } = await supabaseAdmin
      .from('course_materials')
      .select('title, type, url, storage_path, content_text')
      .eq('course_id', request.course_id)
      .order('order_index', { ascending: true });
    if (error) throw new Error(`Could not load course materials: ${error.message}`);
    const materialText = (materials || [])
      .map((material: any) => `TITLE: ${material.title}\nTYPE: ${material.type}\nSOURCE: ${material.url || material.storage_path || 'course material'}\n${material.content_text || '[No extracted text; use this material as course metadata]'}`)
      .join('\n\n--- MATERIAL ---\n\n');
    documentText = [materialText, documentText].filter(Boolean).join('\n\n--- USER MATERIAL ---\n\n');
  }

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/quiz/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        ...request,
        document_text: documentText || undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json() as any;
    res.json({
      success: true,
      data: {
        questions: data.questions,
        metadata: data.metadata,
      },
    });
  } catch (error: any) {
    console.error('AI quiz generation error:', error);
    res.status(500).json({
      success: false,
      error: `AI service error: ${error.message}. Check that AI service is running on ${AI_SERVICE_URL} and GOOGLE_API_KEY is valid.`,
    });
  }
}));

/**
 * POST /api/ai/quiz/generate-from-file
 *
 * Streams a PDF/DOCX/TXT upload to the AI service. Extraction stays server
 * side so binary PDF contents are never placed in a text area or sent as a
 * fake filename placeholder.
 */
router.post('/quiz/generate-from-file', upload.single('file'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'A PDF, DOCX, or TXT file is required' });
    return;
  }

  let config: Record<string, unknown> = {};
  try { config = JSON.parse(String(req.body.config || '{}')); } catch {
    res.status(400).json({ success: false, error: 'Invalid quiz configuration' });
    return;
  }

  const form = new FormData();
  form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
  form.append('config', JSON.stringify(config));

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/quiz/generate-from-file`, {
      method: 'POST',
      headers: { 'X-API-Key': AI_SERVICE_API_KEY },
      body: form,
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      res.status(response.status).json({ success: false, error: data.detail || data.error || 'File quiz generation failed' });
      return;
    }
    res.json({ success: true, data: { questions: data.questions, metadata: data.metadata } });
  } catch (error: any) {
    res.status(503).json({ success: false, error: `AI service unavailable: ${error.message}` });
  }
}));

router.post('/quiz/submit', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = z.object({
    course_id: z.string().uuid().optional(),
    answers: z.array(z.object({ question_id: z.string(), selected_option: z.number().int().min(0).max(3), correct_answer: z.number().int().min(0).max(3) })),
  }).parse(req.body);
  const correct = body.answers.filter(answer => answer.selected_option === answer.correct_answer).length;
  const score = body.answers.length ? Math.round(correct / body.answers.length * 100) : 0;
  if (body.course_id) {
    await supabaseAdmin.from('learning_signals').insert({
      user_id: req.user!.id,
      course_id: body.course_id,
      signal_type: 'quiz_score',
      signal_value: score,
      signal_metadata: { question_count: body.answers.length, mode: 'adaptive' },
    });

    // Feed the checked result back into the learner graph so dashboard gap
    // charts reflect completed practice immediately.
    const { data: course } = await supabaseAdmin.from('courses').select('target_competencies').eq('id', body.course_id).maybeSingle();
    for (const competencyId of course?.target_competencies || []) {
      const { data: current } = await supabaseAdmin.from('user_competency_scores').select('current_score, required_score').eq('user_id', req.user!.id).eq('competency_id', competencyId).maybeSingle();
      if (current) {
        await supabaseAdmin.from('user_competency_scores').update({ current_score: Math.min(5, Number(current.current_score || 0) + (score / 100) * 0.2), updated_at: new Date().toISOString() }).eq('user_id', req.user!.id).eq('competency_id', competencyId);
      }
    }
  }
  res.json({ success: true, data: { score, correct, total: body.answers.length } });
}));

router.get('/questions', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseAdmin.from('questions').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false });
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.json({ success: true, data: data || [] });
}));

router.post('/questions', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = z.object({
    text: z.string().min(5),
    options: z.array(z.string().min(1)).length(4),
    correct_answer: z.number().int().min(0).max(3),
    bloom_level: z.string().default('understand'),
    difficulty_beta: z.number().min(-3).max(3).default(0),
    explanation: z.string().optional(),
    language: z.string().default('en'),
    course_id: z.string().uuid().optional(),
    content_hash: z.string().optional(),
  }).parse(req.body);
  const { data, error } = await supabaseAdmin.from('questions').insert({ ...body, user_id: req.user!.id, source: 'ai_generated' }).select().single();
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.status(201).json({ success: true, data });
}));

router.post('/speech-to-text', upload.single('file'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file || req.file.size < 300) { res.status(400).json({ success: false, error: 'Audio file is required (empty recording — hold mic and speak for 1-2s)' }); return; }
  const key = process.env.SARVAM_API_KEY;
  if (!key) { res.status(503).json({ success: false, error: 'SARVAM_API_KEY is not configured' }); return; }
  // Normalize BCP-47: Sarvam expects en-IN not en-US, od-IN for Odia; use unknown for auto-detect when needed
  const rawLang = String(req.body.language_code || 'unknown').trim();
  const normMap: Record<string,string> = { 'en-US':'en-IN', 'en':'en-IN', 'or-IN':'od-IN', 'or':'od-IN', 'pa-IN':'pa-IN' };
  let language_code = normMap[rawLang] || rawLang;
  const allowed = new Set(['en-IN','hi-IN','bn-IN','ta-IN','te-IN','mr-IN','gu-IN','kn-IN','ml-IN','pa-IN','od-IN','as-IN','ur-IN','ne-IN','kok-IN','ks-IN','sd-IN','sa-IN','sat-IN','mni-IN','brx-IN','mai-IN','doi-IN','unknown']);
  if (!allowed.has(language_code)) language_code = 'unknown';
  const trySarvam = async (lc: string) => {
    const f = new FormData();
    f.append('file', new Blob([req.file!.buffer], { type: req.file!.mimetype || 'audio/webm' }), req.file!.originalname || 'recording.webm');
    f.append('model', 'saaras:v3');
    f.append('language_code', lc);
    const r = await fetch('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': key }, body: f as any });
    const j = await r.json().catch(() => ({})) as any;
    return { r, j };
  };
  try {
    let { r: response, j: data } = await trySarvam(language_code);
    // Empty transcript with explicit lang → retry auto-detect (fixes Hindi spoken while selector on en-IN)
    if (response.ok && (!data.transcript || !String(data.transcript).trim()) && language_code !== 'unknown') {
      console.log(`Sarvam empty with ${language_code}, retrying unknown for size=${req.file!.size}`);
      const retry = await trySarvam('unknown');
      if (retry.r.ok && retry.j.transcript && String(retry.j.transcript).trim()) {
        response = retry.r as any; data = retry.j;
        console.log(`Sarvam retry unknown succeeded: lang=${data.language_code} transcript=${String(data.transcript).slice(0,80)}`);
      }
    }
    if (!response.ok) {
      console.error(`Sarvam STT ${response.status} lang=${language_code} file=${req.file!.mimetype} size=${req.file!.size}:`, JSON.stringify(data).slice(0,400));
      res.status(response.status).json({ success: false, error: data.message || data.error || `Sarvam transcription failed (${response.status})` }); return;
    }
    if (!data.transcript || !String(data.transcript).trim()) {
      res.status(422).json({ success: false, error: 'No speech detected — try speaking Hindi clearly 1-2s, mic close, or switch language selector to हिन्दी before recording' }); return;
    }
    res.json({ success: true, data: { transcript: data.transcript || '', language_code: data.language_code || language_code, request_id: data.request_id } });
  } catch (error: any) { console.error('Sarvam fetch error', error); res.status(503).json({ success: false, error: `Sarvam unavailable: ${error.message}` }); }
}));

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
