-- ============================================================
-- SkillUp Platform — Schema Migrations
-- Run in: Supabase SQL Editor → New Query → Run All
-- ============================================================

-- ============================================================
-- 1. ADMIN BANNERS TABLE
-- Why: Admin can push popups/announcements to specific users
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info','warning','critical','success')),
  target_departments TEXT[] DEFAULT '{}',
  target_designations TEXT[] DEFAULT '{}',
  target_ministries TEXT[] DEFAULT '{}',
  target_levels TEXT[] DEFAULT '{}',
  target_categories TEXT[] DEFAULT '{}',
  related_course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  cta_label VARCHAR(50),
  cta_url TEXT,
  starts_at TIMESTAMPTZ DEFAULT now(),
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admin_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read active banners"
  ON public.admin_banners FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access banners"
  ON public.admin_banners FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================
-- 2. COURSE REMINDERS TABLE
-- Why: Track incomplete course reminders, snooze, popup + email
-- ============================================================
CREATE TABLE IF NOT EXISTS public.course_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES public.course_enrollments(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  reminder_type VARCHAR(30) DEFAULT 'completion' CHECK (reminder_type IN ('completion','engagement','admin')),
  message TEXT,
  is_sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  snoozed_count INT DEFAULT 0,
  admin_banner_id UUID REFERENCES public.admin_banners(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.course_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own reminders"
  ON public.course_reminders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access reminders"
  ON public.course_reminders FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================
-- 3. DISMISSED BANNERS TABLE (user dismissed tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dismissed_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  banner_id UUID REFERENCES public.admin_banners(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, banner_id)
);

ALTER TABLE public.dismissed_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own dismissed banners"
  ON public.dismissed_banners FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- 4. DAILY AI SUGGESTIONS CACHE TABLE
-- Why: Cache AI-generated daily suggestions to avoid re-computing
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_daily_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  suggestions JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.ai_daily_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own suggestions"
  ON public.ai_daily_suggestions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access suggestions"
  ON public.ai_daily_suggestions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================
-- Verify all tables
-- ============================================================
SELECT 'admin_banners' as table_name, COUNT(*) as rows FROM public.admin_banners
UNION ALL
SELECT 'course_reminders', COUNT(*) FROM public.course_reminders
UNION ALL
SELECT 'dismissed_banners', COUNT(*) FROM public.dismissed_banners
UNION ALL
SELECT 'ai_daily_suggestions', COUNT(*) FROM public.ai_daily_suggestions;
