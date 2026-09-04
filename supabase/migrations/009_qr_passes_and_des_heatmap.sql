-- ============================================
-- 009 — QR Identity Passes + DES State/District heatmap
-- Run in Supabase SQL Editor (idempotent)
-- ============================================

-- 1. Extend profiles with state/district for DES regional view (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='state') THEN
    ALTER TABLE public.profiles ADD COLUMN state TEXT DEFAULT 'Delhi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='district') THEN
    ALTER TABLE public.profiles ADD COLUMN district TEXT DEFAULT 'Central';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='photo_url') THEN
    ALTER TABLE public.profiles ADD COLUMN photo_url TEXT;
  END IF;
END $$;

-- Seed some DES states for demo (spread existing users)
UPDATE public.profiles SET state = CASE 
  WHEN department = 'NSSO' THEN (ARRAY['Bihar','Uttar Pradesh','Maharashtra','Tamil Nadu','West Bengal'])[1+ (abs(hashtext(id::text)) % 5)]
  WHEN department = 'CSO' THEN (ARRAY['Karnataka','Gujarat','Rajasthan','Madhya Pradesh','Delhi'])[1+ (abs(hashtext(id::text)) % 5)]
  ELSE (ARRAY['Delhi','Odisha','Assam','Kerala','Punjab'])[1+ (abs(hashtext(id::text)) % 5)]
END WHERE state IS NULL OR state='Delhi';

-- 2. Investigator Identity Passes — QR-enabled, skill-tied, tamper-proof (PDF Template 2)
CREATE TABLE IF NOT EXISTS public.investigator_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  des_name TEXT NOT NULL, -- e.g., DES Bihar, NSSO Field
  state TEXT NOT NULL,
  district TEXT,
  designation TEXT NOT NULL,
  photo_url TEXT,
  verification_code TEXT UNIQUE NOT NULL, -- IP-YYYYMMDD-XXXXXXXX QR payload
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_until DATE DEFAULT (CURRENT_DATE + INTERVAL '1 year'),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  issued_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_pass_user ON public.investigator_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_pass_code ON public.investigator_passes(verification_code);
CREATE INDEX IF NOT EXISTS idx_inv_pass_state ON public.investigator_passes(state);

ALTER TABLE public.investigator_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own passes" ON public.investigator_passes;
CREATE POLICY "Users view own passes" ON public.investigator_passes FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Public verify passes" ON public.investigator_passes;
CREATE POLICY "Public verify passes" ON public.investigator_passes FOR SELECT USING (true);
DROP POLICY IF EXISTS "Service role passes" ON public.investigator_passes;
CREATE POLICY "Service role passes" ON public.investigator_passes FOR ALL USING (auth.jwt()->>'role'='service_role') WITH CHECK (true);

-- 3. Skill-tied badge extensions: add verification context to existing badges if needed
-- badges already gamification; link passes to competencies via user_competency_scores
-- No new table for badge QR — reuse investigator_passes + certificates verification_code

-- 4. Helper view for DES heatmap
CREATE OR REPLACE VIEW public.des_competency_heatmap AS
SELECT
  COALESCE(p.state,'Unknown') as state,
  cd.name as domain,
  AVG(ucs.current_score) as avg_score,
  AVG(ucs.gap_score) as avg_gap,
  COUNT(*) as officials
FROM public.user_competency_scores ucs
JOIN public.profiles p ON ucs.user_id = p.id
JOIN public.competencies c ON ucs.competency_id = c.id
JOIN public.competency_domains cd ON c.domain_id = cd.id
GROUP BY p.state, cd.name;

-- Verify
SELECT 'profiles.state added' as check, COUNT(DISTINCT state) as states FROM public.profiles
UNION ALL SELECT 'investigator_passes', COUNT(*) FROM public.investigator_passes
UNION ALL SELECT 'des_heatmap rows', COUNT(*) FROM public.des_competency_heatmap;
