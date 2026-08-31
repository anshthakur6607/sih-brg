/**
 * Gamification Service
 * 
 * Awards points, badges, and tracks streaks.
 * 
 * Why: Government officials respond to recognition. Gamification tied to
 * career progression (not just points) drives sustained engagement.
 */

import { supabaseAdmin } from '../lib/supabase.js';

export async function awardPoints(userId: string, points: number, reason: string) {
  try {
    // Update total points
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('total_points, current_streak_days, longest_streak_days, last_active_at')
      .eq('id', userId)
      .single();

    if (!profile) return;

    const newTotal = (profile.total_points || 0) + points;
    const today = new Date().toISOString().split('T')[0];
    const lastActive = profile.last_active_at?.split('T')[0];
    
    let newStreak = profile.current_streak_days || 0;
    if (lastActive !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      newStreak = lastActive === yesterday ? newStreak + 1 : 1;
    }

    await supabaseAdmin
      .from('profiles')
      .update({
        total_points: newTotal,
        current_streak_days: newStreak,
        longest_streak_days: Math.max(newStreak, profile.longest_streak_days || 0),
        last_active_at: new Date().toISOString(),
      })
      .eq('id', userId);

    // Check badge criteria
    await checkAndAwardBadges(userId, { total_points: newTotal, current_streak_days: newStreak });
  } catch (err) {
    console.error('Award points failed:', err);
  }
}

export async function checkAndAwardBadges(userId: string, stats: any) {
  try {
    const { data: badges } = await supabaseAdmin.from('badges').select('*');
    const { data: earned } = await supabaseAdmin.from('user_badges').select('badge_id').eq('user_id', userId);
    const earnedIds = new Set((earned || []).map(e => e.badge_id));

    for (const badge of badges || []) {
      if (earnedIds.has(badge.id)) continue;

      const criteria = badge.criteria as any;
      let shouldAward = false;

      if (criteria.type === 'courses_completed') {
        const { count } = await supabaseAdmin
          .from('course_enrollments')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'completed');
        shouldAward = (count || 0) >= criteria.value;
      } else if (criteria.type === 'streak_days') {
        shouldAward = (stats.current_streak_days || 0) >= criteria.value;
      } else if (criteria.type === 'perfect_quizzes') {
        const { count } = await supabaseAdmin
          .from('assessment_attempts')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('auto_score', 100);
        shouldAward = (count || 0) >= criteria.value;
      } else if (criteria.type === 'certificates') {
        const { count } = await supabaseAdmin
          .from('certificates')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);
        shouldAward = (count || 0) >= criteria.value;
      } else if (criteria.type === 'domain_mastery') {
        const { data: comps } = await supabaseAdmin
          .from('user_competency_scores')
          .select('current_score, competency:competencies(domain:competency_domains(name))')
          .eq('user_id', userId);
        const domainScores = (comps || [])
          .filter((c: any) => c.competency?.domain?.name === criteria.domain)
          .map((c: any) => c.current_score);
        shouldAward = domainScores.length > 0 && domainScores.every((s: number) => s >= criteria.value);
      }

      if (shouldAward) {
        await supabaseAdmin.from('user_badges').insert({
          user_id: userId,
          badge_id: badge.id,
        });
        // Award badge points too
        await supabaseAdmin
          .from('profiles')
          .update({ total_points: supabaseAdmin.rpc('increment_total_points', { x: badge.points || 0 }) })
          .eq('id', userId);
      }
    }
  } catch (err) {
    console.error('Badge check failed:', err);
  }
}

export async function getUserBadges(userId: string) {
  const { data } = await supabaseAdmin
    .from('user_badges')
    .select('*, badge:badges(*)')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });
  return data || [];
}

export async function getLeaderboard(limit = 10) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, designation, department, total_points, current_streak_days')
    .order('total_points', { ascending: false })
    .limit(limit);
  return data || [];
}
