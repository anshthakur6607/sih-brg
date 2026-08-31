/**
 * Gamification Routes
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getUserBadges, getLeaderboard } from '../services/gamification.js';

const router = Router();

/**
 * GET /api/gamification/badges
 */
router.get('/badges', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const allBadges = await supabaseAdmin.from('badges').select('*').order('points', { ascending: true });
  const userBadges = await supabaseAdmin
    .from('user_badges')
    .select('badge_id, earned_at')
    .eq('user_id', userId);

  const earnedMap = new Map((userBadges.data || []).map(ub => [ub.badge_id, ub.earned_at]));

  const badges = (allBadges.data || []).map(badge => ({
    ...badge,
    earned_at: earnedMap.get(badge.id) || null,
  }));

  res.json({ success: true, data: badges });
}));

/**
 * GET /api/gamification/leaderboard
 */
router.get('/leaderboard', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const leaderboard = await getLeaderboard(10);
  const ranked = leaderboard.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
  res.json({ success: true, data: ranked });
}));

/**
 * GET /api/gamification/stats
 */
router.get('/stats', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const { count: courses } = await supabaseAdmin
    .from('course_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'completed');
  const { count: certs } = await supabaseAdmin
    .from('certificates')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  const { count: perfect } = await supabaseAdmin
    .from('assessment_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('auto_score', 100);

  res.json({
    success: true,
    data: {
      total_points: profile?.total_points || 0,
      current_streak_days: profile?.current_streak_days || 0,
      longest_streak_days: profile?.longest_streak_days || 0,
      courses_completed: courses || 0,
      certificates: certs || 0,
      perfect_quizzes: perfect || 0,
    },
  });
}));

export default router;