/**
 * Daily Suggestions Routes
 *
 * AI-powered daily course suggestions for future-readiness:
 * - Personalized recommendations based on competencies, role, and trends
 * - Trending/upcoming courses by role and department
 *
 * Uses Gemini via the AI service proxy (port 8001).
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8001').replace(/\/+$/, '');
const AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY || '';

router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('designation, department, ministry, organization_level, learning_category')
    .eq('id', userId)
    .single();

  const { data: competencies } = await supabaseAdmin
    .from('user_competency_scores')
    .select('current_score, required_score, competency:competencies(name, domain:competency_domains(name))')
    .eq('user_id', userId);

  const { data: enrolledCourses } = await supabaseAdmin
    .from('course_enrollments')
    .select('course_id, status')
    .eq('user_id', userId);

  const enrolledCourseIds = new Set((enrolledCourses || []).map(e => e.course_id));

  const { data: allCourses } = await supabaseAdmin
    .from('courses')
    .select('id, title, provider, duration_hours, target_competencies, source, level, is_trending, upcoming_launch');

  const availableCourses = (allCourses || []).filter(c => !enrolledCourseIds.has(c.id));

  const prompt = `You are an AI learning advisor for SkillUp, a government statistics and data analytics training platform (MoSPI/NSSTA).

Analyze the following user profile and suggest 3-5 courses for future-readiness:

User Profile:
- Designation: ${profile?.designation || 'Not specified'}
- Department: ${profile?.department || 'Not specified'}
- Ministry: ${profile?.ministry || 'Not specified'}
- Organization Level: ${profile?.organization_level || 'Not specified'}

Current Competencies with Scores (${(competencies || []).length} tracked):
${(competencies || []).slice(0, 10).map((c: any) => `- ${c.competency?.name || 'Unknown'} (${c.competency?.domain?.name || 'General'}): Current ${c.current_score?.toFixed(1) || '?'}/5, Required ${c.required_score || 4}/5`).join('\n')}

Available Courses (${availableCourses.length} courses not yet enrolled):
${availableCourses.slice(0, 15).map((c: any) => `- ${c.title} (${c.provider}) - ${c.duration_hours}h - Level: ${c.level || 'Intermediate'}`).join('\n')}

Emerging trends in government statistics: real-time data systems, AI/ML for official statistics, SDG monitoring, census technology, data governance frameworks, sustainable development analytics.

Respond with a JSON object containing:
{
  "suggestions": [
    {
      "course_id": "uuid or null if not found in available courses",
      "course_title": "title",
      "reason": "why this course matters for future readiness",
      "urgency": "immediate|short_term|long_term",
      "competencies_gained": ["list of competencies"],
      "trend_relevance": "how it addresses emerging trends"
    }
  ],
  "summary": "2-3 sentence advisory summary",
  "focus_areas": ["recommended focus areas for development"]
}

Return ONLY valid JSON, no markdown or extra text.`;

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ai/chat/multilingual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_SERVICE_API_KEY,
      },
      body: JSON.stringify({
        message: prompt,
        user_id: userId,
        language: 'en',
        voice_mode: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json() as any;
    let suggestions: any[] = [];
    let parsedObj: any = null;

    try {
      parsedObj = JSON.parse(data.answer);
      if (Array.isArray(parsedObj)) {
        suggestions = parsedObj;
      } else if (parsedObj.suggestions) {
        suggestions = parsedObj.suggestions;
      }
    } catch {
      suggestions = extractSuggestionsFromText(data.answer);
    }

    const validSuggestions = suggestions.filter((s: any) => s && (s.course_id || s.course_title));

    res.json({
      success: true,
      data: {
        suggestions: validSuggestions.slice(0, 5),
        summary: parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj) && parsedObj.summary ? parsedObj.summary : null,
        focus_areas: parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj) && parsedObj.focus_areas ? parsedObj.focus_areas : [],
      },
      meta: {
        user_id: userId,
        competencies_tracked: competencies?.length || 0,
        available_courses: availableCourses.length,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Daily suggestions error:', error);

    const fallback = availableCourses.slice(0, 5).map((c: any) => ({
      course_id: c.id,
      course_title: c.title,
      reason: `Recommended course for ${profile?.department || 'your department'} officials`,
      urgency: 'short_term',
      competencies_gained: [],
      trend_relevance: 'General skill development',
    }));

    res.json({
      success: true,
      data: {
        suggestions: fallback,
        summary: 'Based on your profile, these courses align with your department requirements and professional development goals.',
        focus_areas: ['Data Analytics', 'Statistical Methods', 'Digital Skills'],
      },
      meta: {
        fallback: true,
        error: 'AI service unavailable',
      },
    });
  }
}));

router.get('/trending', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { limit = '10' } = req.query;
  const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 10));

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('department, ministry, organization_level')
    .eq('id', userId)
    .single();

  const { data: trendingCourses } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('is_trending', true)
    .limit(limitNum);

  const { data: upcomingCourses } = await supabaseAdmin
    .from('courses')
    .select('*')
    .not('upcoming_launch', 'is', null)
    .order('upcoming_launch', { ascending: true })
    .limit(5);

  const { data: popularByDept } = await supabaseAdmin
    .from('courses')
    .select('*')
    .order('enrollment_count', { ascending: false })
    .limit(10);

  let departmentSpecific: any[] = [];
  if (profile?.department) {
    const { data: deptCourses } = await supabaseAdmin
      .from('courses')
      .select('*')
      .eq('department', profile.department)
      .limit(10);
    departmentSpecific = deptCourses || [];
  }

  res.json({
    success: true,
    data: {
      trending: trendingCourses || [],
      upcoming: upcomingCourses || [],
      popular: popularByDept || [],
      department_specific: departmentSpecific,
    },
    meta: {
      department: profile?.department || null,
      limit: limitNum,
      generated_at: new Date().toISOString(),
    },
  });
}));

function extractSuggestionsFromText(text: string): any[] {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.suggestions) return parsed.suggestions;
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    const lines = text.split('\n').filter((l: string) => l.trim());
    return lines.slice(0, 5).map((l: string, i: number) => ({
      course_title: l.replace(/^[-*\d.]+\s*/, '').trim(),
      reason: 'Based on your profile and current trends',
      urgency: i < 2 ? 'immediate' : 'short_term',
      competencies_gained: [],
      trend_relevance: 'Professional development',
    }));
  }
  return [];
}

export default router;
