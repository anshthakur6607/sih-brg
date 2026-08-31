/**
 * Course Reminders Routes
 *
 * Handles course completion reminders:
 * - Admin sends reminders to users about incomplete courses
 * - Users can view their pending reminders
 * - Snooze functionality for reminders
 * - Stats for admin dashboard
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { requireAdmin, requireManager, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const sendReminderSchema = z.object({
  user_ids: z.array(z.string().uuid()).optional(),
  enrollment_ids: z.array(z.string().uuid()).optional(),
  course_id: z.string().uuid().optional(),
  target_departments: z.array(z.string()).optional(),
  message: z.string().min(1).max(500),
  reminder_type: z.enum(['completion', 'engagement', 'admin']).default('admin'),
});

const snoozeSchema = z.object({
  days: z.number().min(1).max(30).default(3),
});

router.post('/send', requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validatedData = sendReminderSchema.parse(req.body);
  const adminId = req.user!.id;

  let targetEnrollmentIds = validatedData.enrollment_ids || [];

  if (!targetEnrollmentIds.length) {
    let enrollmentsQuery = supabaseAdmin
      .from('course_enrollments')
      .select('id, user_id, course_id, status, progress_percentage')
      .neq('status', 'completed');

    if (validatedData.course_id) {
      enrollmentsQuery = enrollmentsQuery.eq('course_id', validatedData.course_id);
    }

    if (validatedData.user_ids?.length) {
      enrollmentsQuery = enrollmentsQuery.in('user_id', validatedData.user_ids);
    }

    if (validatedData.target_departments?.length) {
      const { data: targetUsers } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .in('department', validatedData.target_departments);
      const userIds = targetUsers?.map(u => u.id) || [];
      if (userIds.length) {
        enrollmentsQuery = enrollmentsQuery.in('user_id', userIds);
      }
    }

    const { data: enrollments } = await enrollmentsQuery;
    targetEnrollmentIds = (enrollments || [])
      .filter(e => e.status !== 'completed')
      .map(e => e.id);
  }

  if (!targetEnrollmentIds.length) {
    res.json({ success: true, data: { reminders_created: 0 }, message: 'No incomplete enrollments found' });
    return;
  }

  const { data: enrollments } = await supabaseAdmin
    .from('course_enrollments')
    .select('*, course:courses(id, title, provider)')
    .in('id', targetEnrollmentIds);

  const bannerInsert = {
    title: 'Course Completion Reminder',
    message: validatedData.message,
    severity: 'info' as const,
    target_categories: ['reminder'] as string[],
    related_course_id: validatedData.course_id || null,
    cta_label: 'Continue Learning',
    cta_url: '/courses',
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    is_active: true,
    created_by: adminId,
  };

  const { data: banner, error: bannerError } = await supabaseAdmin
    .from('admin_banners')
    .insert(bannerInsert)
    .select()
    .single();

  if (bannerError) {
    console.error('Banner creation error:', bannerError);
    res.status(500).json({ success: false, error: 'Failed to create banner' });
    return;
  }

  const reminderInserts = (enrollments || []).map(e => ({
    user_id: e.user_id,
    enrollment_id: e.id,
    course_id: e.course_id,
    reminder_type: validatedData.reminder_type,
    message: validatedData.message,
    is_sent: true,
    sent_at: new Date().toISOString(),
    admin_banner_id: banner.id,
  }));

  const { error: reminderError } = await supabaseAdmin
    .from('course_reminders')
    .insert(reminderInserts);

  if (reminderError) {
    console.error('Reminder creation error:', reminderError);
  }

  res.json({
    success: true,
    data: {
      reminders_created: reminderInserts.length,
      banner_id: banner.id,
    },
    message: `Sent reminders to ${reminderInserts.length} user(s)`,
  });
}));

router.get('/pending', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const now = new Date().toISOString();

  try {
    const { data, error } = await supabaseAdmin
      .from('course_reminders')
      .select(`
        *,
        enrollment:course_enrollments(id, progress_percentage, started_at, expected_completion_at),
        course:courses(id, title, provider, duration_hours, thumbnail_url)
      `)
      .eq('user_id', userId)
      .eq('is_sent', true)
      .or(`snoozed_until.is.null,snoozed_until.lt.${now}`);

    if (error) {
      // Table doesn't exist yet — return empty list (frontend will gracefully skip)
      if (error.code === '42P01' || error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === 'PGRST205') {
        res.json({ success: true, data: [] });
        return;
      }
      console.error('Error fetching pending reminders:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch pending reminders' });
      return;
    }

    const activeReminders = (data || []).filter(r => {
      if (!r.enrollment || r.enrollment.status === 'completed') return false;
      return true;
    });

    res.json({
      success: true,
      data: activeReminders,
    });
  } catch (e: any) {
    if (e?.code === '42P01' || e?.code === 'PGRST205' || e?.message?.includes('does not exist') || e?.message?.includes('relation')) {
      res.json({ success: true, data: [] });
      return;
    }
    throw e;
  }
}));

router.post('/check', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: enrollments } = await supabaseAdmin
    .from('course_enrollments')
    .select('*, course:courses(id, title, provider, duration_hours)')
    .eq('user_id', userId)
    .neq('status', 'completed');

  const incompleteEnrollments = (enrollments || []).filter(e => e.progress_percentage < 100);

  if (incompleteEnrollments.length === 0) {
    res.json({ success: true, data: { has_reminders: false, count: 0, enrollments: [] } });
    return;
  }

  const enrollmentIds = incompleteEnrollments.map(e => e.id);
  const now = new Date().toISOString();

  const { data: reminders } = await supabaseAdmin
    .from('course_reminders')
    .select('*')
    .in('enrollment_id', enrollmentIds)
    .eq('is_sent', true)
    .or(`snoozed_until.is.null,snoozed_until.lt.${now}`);

  const activeReminderMap = new Map<string, boolean>();
  reminders?.forEach(r => {
    if (!activeReminderMap.has(r.enrollment_id)) {
      activeReminderMap.set(r.enrollment_id, true);
    }
  });

  const reminderEnrollments = incompleteEnrollments
    .filter(e => activeReminderMap.has(e.id))
    .map(e => ({
      enrollment_id: e.id,
      course_id: e.course_id,
      course_title: e.course?.title,
      provider: e.course?.provider,
      progress_percentage: e.progress_percentage,
      started_at: e.started_at,
      expected_completion_at: e.expected_completion_at,
    }));

  res.json({
    success: true,
    data: {
      has_reminders: reminderEnrollments.length > 0,
      count: reminderEnrollments.length,
      enrollments: reminderEnrollments,
    },
  });
}));

router.post('/snooze/:enrollmentId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { enrollmentId } = req.params;
  const { days } = snoozeSchema.parse(req.body);

  const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data: existing } = await supabaseAdmin
    .from('course_reminders')
    .select('id, snoozed_count')
    .eq('user_id', userId)
    .eq('enrollment_id', enrollmentId)
    .eq('is_sent', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_reminders')
      .update({ snoozed_until: snoozedUntil, snoozed_count: (existing.snoozed_count || 0) + 1 })
      .eq('id', existing.id);

    if (error) {
      res.status(500).json({ success: false, error: 'Failed to snooze reminder' });
      return;
    }
  } else {
    const { data: enrollment } = await supabaseAdmin
      .from('course_enrollments')
      .select('id, course_id')
      .eq('id', enrollmentId)
      .single();

    if (!enrollment) {
      throw new NotFoundError('Enrollment');
    }

    await supabaseAdmin.from('course_reminders').insert({
      user_id: userId,
      enrollment_id: enrollmentId,
      course_id: enrollment.course_id,
      reminder_type: 'completion',
      is_sent: false,
      snoozed_until: snoozedUntil,
      snoozed_count: 1,
    });
  }

  res.json({
    success: true,
    data: { snoozed_until: snoozedUntil, snoozed_days: days },
    message: `Reminder snoozed for ${days} day(s)`,
  });
}));

router.get('/admin/stats', requireManager, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { department, course_id } = req.query;

  let query = supabaseAdmin
    .from('course_reminders')
    .select(`
      *,
      user:profiles!user_id(id, full_name, email, department, designation),
      course:courses!course_id(id, title, provider)
    `, { count: 'exact' })
    .eq('is_sent', true);

  if (course_id) query = query.eq('course_id', course_id as string);
  if (department) {
    const { data: deptUsers } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('department', department as string);
    const userIds = deptUsers?.map(u => u.id) || [];
    if (userIds.length) query = query.in('user_id', userIds);
  }

  const { data: reminders, error } = await query;

  if (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    return;
  }

  const deptStats: Record<string, { total: number; snoozed: number; users: Set<string> }> = {};
  const courseStats: Record<string, { total: number; snoozed: number }> = {};

  reminders?.forEach(r => {
    const dept = r.user?.department || 'Unknown';
    if (!deptStats[dept]) deptStats[dept] = { total: 0, snoozed: 0, users: new Set() };
    deptStats[dept].total++;
    if (r.snoozed_until) deptStats[dept].snoozed++;
    if (r.user?.id) deptStats[dept].users.add(r.user.id);

    const courseKey = r.course?.title || 'Unknown';
    if (!courseStats[courseKey]) courseStats[courseKey] = { total: 0, snoozed: 0 };
    courseStats[courseKey].total++;
    if (r.snoozed_until) courseStats[courseKey].snoozed++;
  });

  const byDepartment = Object.entries(deptStats).map(([dept, stats]) => ({
    department: dept,
    reminder_count: stats.total,
    snoozed_count: stats.snoozed,
    unique_users: stats.users.size,
  })).sort((a, b) => b.reminder_count - a.reminder_count);

  const byCourse = Object.entries(courseStats).map(([course, stats]) => ({
    course,
    reminder_count: stats.total,
    snoozed_count: stats.snoozed,
  })).sort((a, b) => b.reminder_count - a.reminder_count);

  res.json({
    success: true,
    data: {
      total_reminders: reminders?.length || 0,
      by_department: byDepartment,
      by_course: byCourse,
    },
  });
}));

export default router;
