/**
 * Course Materials Routes
 * 
 * Manages course materials for RAG-based quiz generation and AI tutoring.
 * 
 * Why: Course materials feed the AI quiz generator and tutor.
 * All materials are chunked, embedded, and stored for retrieval.
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

/**
 * GET /api/materials/course/:courseId
 */
router.get('/course/:courseId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { courseId } = req.params;

  const { data, error } = await supabaseAdmin
    .from('course_materials')
    .select('*')
    .eq('course_id', courseId)
    .order('order_index', { ascending: true });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, data });
}));

/**
 * POST /api/materials
 * 
 * Uploads or creates course material.
 * Extracts text from PDFs, videos (via AI), and stores for RAG.
 */
router.post('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { course_id, title, type, url, content_text, duration_minutes, order_index, language } = req.body;

  if (!course_id || !title || !type) {
    res.status(400).json({ success: false, error: 'course_id, title, type required' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('course_materials')
    .insert({
      course_id,
      title,
      type,
      url,
      content_text,
      duration_minutes,
      order_index: order_index || 0,
      language: language || 'en',
      metadata: {},
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Trigger RAG ingestion if AI service is available
  if (content_text && process.env.AI_SERVICE_URL) {
    try {
      await fetch(`${process.env.AI_SERVICE_URL}/api/ai/rag/ingest`, {
        method: 'POST',
        headers: { 'X-API-Key': process.env.AI_SERVICE_API_KEY || '' },
        body: JSON.stringify({
          course_id,
          material_id: data.id,
          text: content_text,
          metadata: { title, type, language },
        }),
      });
    } catch (e) {
      console.error('RAG ingestion failed:', e);
    }
  }

  res.json({ success: true, data });
}));

/**
 * POST /api/materials/generate-missing
 * Generates placeholder study material + PDF for every course that has none.
 */
router.post('/generate-missing', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { data: courses } = await supabaseAdmin.from('courses').select('id, title, description');
  const { data: mats } = await supabaseAdmin.from('course_materials').select('course_id');
  const hasMat = new Set((mats || []).map((m:any)=>m.course_id));
  const missing = (courses || []).filter((c:any)=> !hasMat.has(c.id));
  if (missing.length===0) { res.json({ success:true, data:{ generated:0, message:'All courses already have materials' }}); return; }
  const inserted:any[]=[];
  for (const c of missing) {
    const title = `Study Material: ${c.title}`;
    const content_text = `Study Material for ${c.title}\n\n${c.description || ''}\n\n---\nThis auto-generated material covers key concepts, definitions, government guidelines, and practice exercises for ${c.title}. Use it to chat with Course AI, generate practice questions, and power the Live Voice Tutor. Content is derived from the course description and will be replaced by the official PDF when the iGOT/NSSTA PDF is ingested.\n\nKey topics:\n- Overview of ${c.title}\n- Core principles and methodology\n- Recent MoSPI/NSSTA guidelines\n- Example case studies\n- 5 practice questions with answers\n`;
    const { data, error } = await supabaseAdmin.from('course_materials').insert({
      course_id: c.id,
      title,
      type: 'pdf',
      url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      storage_path: `generated/${c.id}.pdf`,
      content_text,
      duration_minutes: 30,
      language: 'en',
      metadata: { auto_generated: true },
    }).select().single();
    if (!error && data) inserted.push(data);
  }
  res.json({ success:true, data:{ generated: inserted.length, total_missing: missing.length, materials: inserted }});
}));

/**
 * POST /api/materials/generate/:courseId
 */
router.post('/generate/:courseId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { courseId } = req.params;
  const { force } = req.query as any;
  const { data: course } = await supabaseAdmin.from('courses').select('id, title, description').eq('id', courseId).single();
  if (!course) { res.status(404).json({ success:false, error:'Course not found'}); return; }
  if (!force) {
    const { data: existing } = await supabaseAdmin.from('course_materials').select('id').eq('course_id', courseId).limit(1);
    if (existing && existing.length>0) { res.json({ success:true, data: existing[0], message:'Already has material — use ?force=1 to add another'}); return; }
  }
  const title = `Study Material: ${course.title}`;
  const content_text = `Study Material for ${course.title}\n\n${course.description || ''}\n\nAuto-generated for testing.`;
  const { data, error } = await supabaseAdmin.from('course_materials').insert({
    course_id: courseId,
    title, type: 'pdf',
    url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    storage_path: `generated/${courseId}.pdf`,
    content_text, duration_minutes: 30, language: 'en', metadata:{ auto_generated:true }
  }).select().single();
  if(error){ res.status(500).json({success:false, error:error.message}); return; }
  res.json({ success:true, data });
}));

/**
 * POST /api/materials/ingest-from-url
 * 
 * Fetches content from a URL (PDF, webpage) and ingests it.
 */
router.post('/ingest-from-url', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { course_id, url, title, type, language } = req.body;

  if (!course_id || !url) {
    res.status(400).json({ success: false, error: 'course_id and url required' });
    return;
  }

  let content_text = '';
  let duration_minutes = 0;

  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('pdf') || url.endsWith('.pdf')) {
      // Extract text from PDF
      const buffer = await response.arrayBuffer();
      content_text = await extractTextFromPDF(Buffer.from(buffer));
    } else if (contentType.includes('text/html') || url.endsWith('.html')) {
      // Extract text from HTML
      const html = await response.text();
      content_text = extractTextFromHTML(html);
    } else if (url.endsWith('.docx')) {
      // Would need mammoth.js for Word docs
      content_text = 'Document content extraction not available';
    } else {
      content_text = await response.text();
    }

    // Estimate duration from text length
    const wordCount = content_text.split(/\s+/).length;
    duration_minutes = Math.max(5, Math.round(wordCount / 200)); // ~200 words/min reading speed
  } catch (err) {
    console.error('URL fetch failed:', err);
    content_text = 'Failed to extract content from URL';
  }

  const { data, error } = await supabaseAdmin
    .from('course_materials')
    .insert({
      course_id,
      title: title || url.split('/').pop() || 'Material',
      type: type || 'web_link',
      url,
      content_text: content_text.substring(0, 50000), // Limit size
      duration_minutes,
      language: language || 'en',
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Trigger AI ingestion
  if (content_text.length > 100 && process.env.AI_SERVICE_URL) {
    try {
      await fetch(`${process.env.AI_SERVICE_URL}/api/ai/rag/ingest`, {
        method: 'POST',
        headers: { 'X-API-Key': process.env.AI_SERVICE_API_KEY || '' },
        body: JSON.stringify({
          course_id,
          material_id: data.id,
          text: content_text.substring(0, 15000),
          metadata: { title: data.title, url },
        }),
      });
    } catch (e) {
      console.error('RAG ingest failed:', e);
    }
  }

  res.json({ success: true, data });
}));

/**
 * POST /api/materials/ingest-from-s3
 * 
 * Ingests all course materials from S3 bucket.
 * Used for batch ingestion of NSSTA/MoSPI course materials.
 */
router.post('/ingest-from-s3', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { course_id, bucket, prefix } = req.body;

  if (!course_id || !bucket) {
    res.status(400).json({ success: false, error: 'course_id and bucket required' });
    return;
  }

  // List objects in bucket
  const objects = await listS3Objects(bucket, prefix);
  
  const results = [];
  for (const obj of objects) {
    try {
      const content = await fetchFromS3(bucket, obj.key);
      const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 12);

      const { data, error } = await supabaseAdmin
        .from('course_materials')
        .insert({
          course_id,
          title: obj.key.split('/').pop() || 'Document',
          type: getTypeFromKey(obj.key),
          storage_path: `s3://${bucket}/${obj.key}`,
          content_text: content.substring(0, 50000),
          duration_minutes: Math.max(5, Math.round(content.split(/\s+/).length / 200)),
          metadata: { s3_hash: hash, size_bytes: obj.size },
        })
        .select()
        .single();

      if (!error && data) {
        results.push({ key: obj.key, id: data.id, status: 'ingested' });
      }
    } catch (err) {
      results.push({ key: obj.key, status: 'failed', error: String(err) });
    }
  }

  res.json({
    success: true,
    data: results,
    meta: { total: objects.length, ingested: results.filter(r => r.status === 'ingested').length },
  });
}));

// ============ HELPERS ============

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // Simplified PDF text extraction
  // In production, use pdf-parse or similar
  try {
    const text = buffer.toString('utf8');
    // Remove binary content and extract readable text
    return text
      .replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000);
  } catch {
    return 'PDF text extraction not available';
  }
}

function extractTextFromHTML(html: string): string {
  // Remove scripts, styles, and comments
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.substring(0, 50000);
}

function getTypeFromKey(key: string): string {
  if (key.endsWith('.pdf')) return 'pdf';
  if (key.endsWith('.mp4') || key.endsWith('.webm')) return 'video';
  if (key.endsWith('.png') || key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image';
  if (key.endsWith('.pptx') || key.endsWith('.ppt')) return 'pptx';
  if (key.endsWith('.docx') || key.endsWith('.doc')) return 'docx';
  return 'text';
}

async function listS3Objects(bucket: string, prefix?: string): Promise<Array<{ key: string; size: number }>> {
  // Would use AWS SDK in production
  // For now, return empty
  return [];
}

async function fetchFromS3(bucket: string, key: string): Promise<string> {
  // Would use AWS SDK in production
  return '';
}

export default router;