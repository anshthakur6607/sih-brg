/**
 * Admin Banners Routes
 * 
 * Handles pop-up banners/announcements that target specific users
 * based on department, role, designation, ministry, level, or category.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';
import { requireManager, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const createBannerSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical', 'success']).optional().default('info'),
  target_departments: z.array(z.string()).optional().default([]),
  target_designations: z.array(z.string()).optional().default([]),
  target_ministries: z.array(z.string()).optional().default([]),
  target_levels: z.array(z.string()).optional().default([]),
  target_categories: z.array(z.enum(['mandatory', 'recommended', 'compliance'])).optional().default([]),
  related_course_id: z.string().uuid().nullable().optional(),
  cta_label: z.string().max(50).nullable().optional(),
  cta_url: z.string().nullable().optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

const updateBannerSchema = createBannerSchema.partial();

function bannerMatchesUser(banner: Record<string, unknown>, userProfile: Record<string, unknown>): boolean {
  const userDept = userProfile.department as string | null;
  const userDesig = userProfile.designation as string | null;
  const userMinistry = userProfile.ministry as string | null;
  const userLevel = userProfile.organization_level as string | null;
  const userCategory = userProfile.learning_category as string | null;

  const checkEmptyOrContains = (targetArr: string[], userVal: string | null): boolean => {
    if (targetArr.length === 0) return true;
    return userVal != null && targetArr.includes(userVal);
  };

  if (!checkEmptyOrContains((banner.target_departments as string[]) || [], userDept)) return false;
  if (!checkEmptyOrContains((banner.target_designations as string[]) || [], userDesig)) return false;
  if (!checkEmptyOrContains((banner.target_ministries as string[]) || [], userMinistry)) return false;
  if (!checkEmptyOrContains((banner.target_levels as string[]) || [], userLevel)) return false;
  if (!checkEmptyOrContains((banner.target_categories as string[]) || [], userCategory)) return false;

  return true;
}

function isBannerCurrentlyActive(banner: Record<string, unknown>): boolean {
  if (!banner.is_active) return false;
  const now = new Date();
  const startsAt = banner.starts_at ? new Date(banner.starts_at as string) : null;
  const endsAt = banner.ends_at ? new Date(banner.ends_at as string) : null;
  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endsAt) return false;
  return true;
}

router.get('/dismissed', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from('banner_dismissals')
    .select('banner_id')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching dismissed banners:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dismissed banners' });
    return;
  }

  res.json({
    success: true,
    data: (data || []).map(d => d.banner_id),
  });
}));

router.post('/:id/dismiss', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('banner_dismissals')
    .upsert({
      banner_id: id,
      user_id: userId,
    }, {
      onConflict: 'banner_id,user_id',
    });

  if (error) {
    console.error('Error dismissing banner:', error);
    res.status(500).json({ success: false, error: 'Failed to dismiss banner' });
    return;
  }

  res.json({
    success: true,
    message: 'Banner dismissed',
  });
}));

router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('department, designation, ministry, organization_level, learning_category')
      .eq('id', userId)
      .maybeSingle();

    // Always allow access; just return empty if no profile or no banners table
    if (!profile) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: banners, error } = await supabaseAdmin
      .from('admin_banners')
      .select('*')
      .eq('is_active', true);

    if (error) {
      // Table doesn't exist yet — return empty list
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('relation')) {
        res.json({ success: true, data: [] });
        return;
      }
      console.error('Error fetching banners:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch banners' });
      return;
    }

    const activeBanners = (banners || []).filter(b => {
      if (!isBannerCurrentlyActive(b)) return false;
      return bannerMatchesUser(b, profile);
    });

    // Dismissals table may not exist yet
    let dismissedIds = new Set<string>();
    try {
      const { data: dismissals } = await supabaseAdmin
        .from('banner_dismissals')
        .select('banner_id')
        .eq('user_id', userId);
      dismissedIds = new Set((dismissals || []).map(d => d.banner_id));
    } catch (e: any) {
      if (e?.code === '42P01' || e?.code === 'PGRST205' || e?.message?.includes('does not exist')) {
        dismissedIds = new Set();
      } else {
        throw e;
      }
    }

    const undismissedBanners = activeBanners
      .filter(b => !dismissedIds.has(b.id))
      .map(b => ({
        id: b.id,
        title: b.title,
        message: b.message,
        severity: b.severity,
        related_course_id: b.related_course_id,
        cta_label: b.cta_label,
        cta_url: b.cta_url,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
      }));

    res.json({
      success: true,
      data: undismissedBanners,
    });
  } catch (e: any) {
    if (e?.code === '42P01' || e?.code === 'PGRST205' || e?.message?.includes('does not exist') || e?.message?.includes('relation')) {
      res.json({ success: true, data: [] });
      return;
    }
    throw e;
  }
}));

router.get('/admin/users', requireManager, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { department, designation, ministry, level, page = '1', page_size = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(page_size as string, 10) || 20));
  const from = (pageNum - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, department, designation, ministry, organization_level, learning_category', { count: 'exact' });

  if (department) query = query.eq('department', department as string);
  if (designation) query = query.eq('designation', designation as string);
  if (ministry) query = query.eq('ministry', ministry as string);
  if (level) query = query.eq('organization_level', level as string);

  const { data: users, error, count } = await query.range(from, to);

  if (error) {
    console.error('Error fetching users for preview:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
    return;
  }

  res.json({
    success: true,
    data: users || [],
    pagination: {
      total: count || 0,
      page: pageNum,
      page_size: pageSize,
      total_pages: Math.ceil((count || 0) / pageSize),
    },
  });
}));

router.get('/admin', requireManager, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page = '1', page_size = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(page_size as string, 10) || 20));
  const from = (pageNum - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: banners, error, count } = await supabaseAdmin
    .from('admin_banners')
    .select(`
      *,
      creator:profiles!created_by(full_name, email)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Error fetching admin banners:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch banners' });
    return;
  }

  res.json({
    success: true,
    data: banners || [],
    pagination: {
      total: count || 0,
      page: pageNum,
      page_size: pageSize,
      total_pages: Math.ceil((count || 0) / pageSize),
    },
  });
}));

router.post('/', requireManager, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const validatedData = createBannerSchema.parse(req.body);
  const createdBy = req.user!.id;

  const insertData = {
    ...validatedData,
    starts_at: validatedData.starts_at || new Date().toISOString(),
    created_by: createdBy,
  };

  const { data: banner, error } = await supabaseAdmin
    .from('admin_banners')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error('Error creating banner:', error);
    res.status(500).json({ success: false, error: 'Failed to create banner' });
    return;
  }

  res.status(201).json({
    success: true,
    data: banner,
    message: 'Banner created successfully',
  });
}));

router.put('/:id', requireManager, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const validatedData = updateBannerSchema.parse(req.body);

  const { data: banner, error } = await supabaseAdmin
    .from('admin_banners')
    .update(validatedData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating banner:', error);
    res.status(500).json({ success: false, error: 'Failed to update banner' });
    return;
  }

  if (!banner) {
    throw new NotFoundError('Banner');
  }

  res.json({
    success: true,
    data: banner,
    message: 'Banner updated successfully',
  });
}));

router.delete('/:id', requireManager, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('admin_banners')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({ success: false, error: 'Failed to delete banner' });
    return;
  }

  res.json({
    success: true,
    message: 'Banner deleted successfully',
  });
}));

export default router;
