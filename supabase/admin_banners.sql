-- Admin Banners Table
-- Pop-up banners/announcements that can target specific users by department, role, designation, etc.

CREATE TABLE IF NOT EXISTS public.admin_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'success')),
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

-- Banner dismissals tracking per user
CREATE TABLE IF NOT EXISTS public.banner_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_id UUID NOT NULL REFERENCES public.admin_banners(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(banner_id, user_id)
);

-- Indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_banners_active ON public.admin_banners(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_banners_starts_at ON public.admin_banners(starts_at);
CREATE INDEX IF NOT EXISTS idx_banners_ends_at ON public.admin_banners(ends_at);
CREATE INDEX IF NOT EXISTS idx_banners_departments ON public.admin_banners USING GIN(target_departments);
CREATE INDEX IF NOT EXISTS idx_banners_designations ON public.admin_banners USING GIN(target_designations);
CREATE INDEX IF NOT EXISTS idx_banners_ministries ON public.admin_banners USING GIN(target_ministries);
CREATE INDEX IF NOT EXISTS idx_banners_levels ON public.admin_banners USING GIN(target_levels);
CREATE INDEX IF NOT EXISTS idx_banners_categories ON public.admin_banners USING GIN(target_categories);
CREATE INDEX IF NOT EXISTS idx_dismissals_user ON public.banner_dismissals(user_id);
CREATE INDEX IF NOT EXISTS idx_dismissals_banner ON public.banner_dismissals(banner_id);

-- Enable Row Level Security
ALTER TABLE public.admin_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banner_dismissals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for admin_banners
-- All authenticated users can read banners (filtered server-side based on user profile)
CREATE POLICY "Authenticated users can read banners"
  ON public.admin_banners
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service role (admin) can insert, update, delete banners
CREATE POLICY "Service role can insert banners"
  ON public.admin_banners
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update banners"
  ON public.admin_banners
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete banners"
  ON public.admin_banners
  FOR DELETE
  TO service_role
  USING (true);

-- RLS Policies for banner_dismissals
-- Users can read their own dismissals
CREATE POLICY "Users can read their own dismissals"
  ON public.banner_dismissals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own dismissals
CREATE POLICY "Users can create their own dismissals"
  ON public.banner_dismissals
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own dismissals (if needed for re-show)
CREATE POLICY "Users can delete their own dismissals"
  ON public.banner_dismissals
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
