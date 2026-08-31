-- ============================================
-- SkillUp v3 Schema - Knowledge Graph, Surveys, Progress, Gamification
-- Run AFTER existing migrations
-- ============================================

-- ============================================
-- 1. JOB ROLES (Government + iGOT roles)
-- ============================================
CREATE TABLE IF NOT EXISTS public.job_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  department TEXT,
  level TEXT, -- Group A, B, C, D
  required_competencies JSONB DEFAULT '[]'::jsonb,
  mandatory_trainings JSONB DEFAULT '[]'::jsonb,
  career_progression JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read job_roles" ON public.job_roles;
CREATE POLICY "Public read job_roles" ON public.job_roles FOR SELECT USING (true);

-- Seed Government + iGOT job roles
INSERT INTO public.job_roles (code, title, department, level, required_competencies, mandatory_trainings) VALUES
('NSSO_INV', 'NSSO Investigator', 'NSSO', 'C', '["Survey Sampling", "Data Collection", "Data Quality", "Communication"]'::jsonb, '["Data Quality Assurance", "Census Operations Overview"]'::jsonb),
('NSSO_SO', 'NSSO Statistical Officer', 'NSSO', 'B', '["Survey Sampling", "Statistical Analysis", "Data Quality", "SQL"]'::jsonb, '["Data Quality Assurance"]'::jsonb),
('CSO_DIRECTOR', 'CSO Director', 'CSO', 'A', '["National Accounts", "Statistical Analysis", "Leadership", "Decision Making"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('CSO_JOINT_DIR', 'CSO Joint Director', 'CSO', 'A', '["National Accounts", "Statistical Analysis", "Team Management", "Communication"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('CSO_DEPUTY_DIR', 'CSO Deputy Director', 'CSO', 'A', '["National Accounts", "Statistical Analysis", "R", "Python"]'::jsonb, '["R for Statistics"]'::jsonb),
('DIID_SCIENTIST', 'DIID Data Scientist', 'DIID', 'A', '["Python", "AI/ML", "SQL", "Data Visualization", "Data Analysis"]'::jsonb, '["Python for Data Analysis", "Introduction to AI/ML"]'::jsonb),
('DIID_ANALYST', 'DIID Data Analyst', 'DIID', 'B', '["Python", "SQL", "Data Visualization", "Statistical Analysis"]'::jsonb, '["SQL for Government Data"]'::jsonb),
('SDR_OFFICER', 'SDR Officer', 'SDR', 'B', '["Statistical Analysis", "Data Quality", "Communication", "Ethics"]'::jsonb, '["Ethics in Public Service"]'::jsonb),
('ESD_OFFICER', 'ESD Officer', 'ESD', 'B', '["Statistical Analysis", "National Accounts", "Data Collection"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('SSD_OFFICER', 'SSD Officer', 'SSD', 'B', '["Statistical Analysis", "Census Operations", "Data Collection"]'::jsonb, '["Census Operations Overview"]'::jsonb),
('IGOT_LEARNER', 'iGOT Generic Learner', 'iGOT', 'All', '["Communication", "Ethics", "Time Management"]'::jsonb, '["Ethics in Public Service"]'::jsonb),
('FIELD_ENUMERATOR', 'Field Enumerator', 'NSSO', 'C', '["Data Collection", "Survey Sampling", "Communication"]'::jsonb, '["Introduction to Survey Sampling"]'::jsonb),
('DISTRICT_OFFICER', 'District Statistical Officer', 'State', 'A', '["Leadership", "Data Collection", "Statistical Analysis", "Communication"]'::jsonb, '["Leadership Skills for Managers"]'::jsonb),
('STATE_DES_OFFICER', 'State DES Officer', 'State', 'A', '["Statistical Analysis", "National Accounts", "Leadership"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('NIC_TECH', 'NIC Technical Officer', 'NIC', 'B', '["Cybersecurity", "Data Privacy", "Python", "SQL"]'::jsonb, '["Cybersecurity Fundamentals", "Data Privacy and Security"]'::jsonb),
('MEITY_OFFICER', 'MeitY Officer', 'MeitY', 'A', '["DPI", "e-Governance", "Cybersecurity", "Leadership"]'::jsonb, '["Digital India Initiative"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 2. SURVEYS (Pre-assessment survey)
-- ============================================
CREATE TABLE IF NOT EXISTS public.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id TEXT, -- nullable TEXT (not FK) so frontend can send any role code
  current_designation TEXT,
  years_experience NUMERIC DEFAULT 0,
  education_level TEXT,
  familiarity_scores JSONB DEFAULT '{}'::jsonb, -- {"Python": 3, "SQL": 4, ...}
  learning_goals TEXT[] DEFAULT '{}',
  preferred_modality TEXT DEFAULT 'self_paced', -- 'self_paced', 'classroom', 'hybrid'
  preferred_language TEXT DEFAULT 'en',
  time_availability TEXT DEFAULT 'medium', -- 'low', 'medium', 'high'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own surveys" ON public.surveys;
CREATE POLICY "Users read own surveys" ON public.surveys FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own surveys" ON public.surveys;
CREATE POLICY "Users insert own surveys" ON public.surveys FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own surveys" ON public.surveys;
CREATE POLICY "Users update own surveys" ON public.surveys FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own surveys" ON public.surveys;
CREATE POLICY "Users delete own surveys" ON public.surveys FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 3. KNOWLEDGE GRAPH (officials ↔ skills ↔ courses ↔ roles)
-- ============================================
CREATE TABLE IF NOT EXISTS public.knowledge_graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL, -- 'user', 'competency', 'course', 'role'
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT NOT NULL, -- 'has_skill', 'requires', 'teaches', 'enrolled_in', 'completed', 'similar_to'
  weight NUMERIC(3,2) DEFAULT 1.0, -- strength of relationship
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kg_source ON public.knowledge_graph_edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_kg_target ON public.knowledge_graph_edges(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_kg_relationship ON public.knowledge_graph_edges(relationship);

ALTER TABLE public.knowledge_graph_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read kg" ON public.knowledge_graph_edges;
CREATE POLICY "Public read kg" ON public.knowledge_graph_edges FOR SELECT USING (true);

-- ============================================
-- 4. COURSE ENROLLMENTS & PROGRESS
-- ============================================
CREATE TABLE IF NOT EXISTS public.course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  source TEXT, -- 'iGOT', 'NSSTA_TPAC', 'MoSPI_Internal', 'SWAYAM', 'DIKSHA'
  external_enrollment_id TEXT, -- iGOT/NSSTA's enrollment ID
  status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'paused', 'dropped'
  progress_percentage NUMERIC(5,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  expected_completion_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  certificate_url TEXT,
  certificate_issued_at TIMESTAMPTZ,
  UNIQUE(user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user ON public.course_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON public.course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON public.course_enrollments(status);

ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own enrollments" ON public.course_enrollments;
CREATE POLICY "Users read own enrollments" ON public.course_enrollments FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own enrollments" ON public.course_enrollments;
CREATE POLICY "Users insert own enrollments" ON public.course_enrollments FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own enrollments" ON public.course_enrollments;
CREATE POLICY "Users update own enrollments" ON public.course_enrollments FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- 5. COURSE MATERIALS (for RAG & quiz generation)
-- ============================================
CREATE TABLE IF NOT EXISTS public.course_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT, -- 'pdf', 'video', 'image', 'pptx', 'web_link', 'text'
  url TEXT,
  storage_path TEXT, -- S3 or Supabase storage path
  content_text TEXT, -- extracted text for RAG
  duration_minutes INT,
  order_index INT DEFAULT 0,
  language TEXT DEFAULT 'en',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_course ON public.course_materials(course_id);

ALTER TABLE public.course_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read materials" ON public.course_materials;
CREATE POLICY "Public read materials" ON public.course_materials FOR SELECT USING (true);

-- ============================================
-- 6. GAMIFICATION: BADGES & MILESTONES
-- ============================================
CREATE TABLE IF NOT EXISTS public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT, -- emoji or icon name
  tier TEXT, -- 'bronze', 'silver', 'gold', 'platinum'
  criteria JSONB, -- e.g. {"type": "courses_completed", "value": 5}
  points INT DEFAULT 0
);

ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read badges" ON public.badges;
CREATE POLICY "Public read badges" ON public.badges FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_id UUID REFERENCES public.badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own badges" ON public.user_badges;
CREATE POLICY "Users read own badges" ON public.user_badges FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own badges" ON public.user_badges;
CREATE POLICY "Users insert own badges" ON public.user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Seed default badges
INSERT INTO public.badges (code, name, description, icon, tier, criteria, points) VALUES
('FIRST_COURSE', 'First Steps', 'Complete your first course', '🎓', 'bronze', '{"type": "courses_completed", "value": 1}'::jsonb, 10),
('COURSE_5', 'Knowledge Seeker', 'Complete 5 courses', '📚', 'silver', '{"type": "courses_completed", "value": 5}'::jsonb, 50),
('COURSE_10', 'Lifelong Learner', 'Complete 10 courses', '🌟', 'gold', '{"type": "courses_completed", "value": 10}'::jsonb, 100),
('QUIZ_MASTER', 'Quiz Master', 'Score 100% on 3 quizzes', '🏆', 'silver', '{"type": "perfect_quizzes", "value": 3}'::jsonb, 75),
('STREAK_7', 'Week Warrior', '7-day learning streak', '🔥', 'bronze', '{"type": "streak_days", "value": 7}'::jsonb, 25),
('STREAK_30', 'Dedicated', '30-day learning streak', '💎', 'gold', '{"type": "streak_days", "value": 30}'::jsonb, 200),
('STREAK_100', 'Centurion', '100-day learning streak', '👑', 'platinum', '{"type": "streak_days", "value": 100}'::jsonb, 1000),
('DOMAIN_STAT', 'Statistical Expert', 'Achieve level 5 in all Statistical competencies', '📊', 'gold', '{"type": "domain_mastery", "domain": "Statistical", "value": 5}'::jsonb, 500),
('DOMAIN_TECH', 'Tech Wizard', 'Achieve level 5 in all Technical competencies', '💻', 'gold', '{"type": "domain_mastery", "domain": "Technical", "value": 5}'::jsonb, 500),
('DOMAIN_DIG', 'Digital Champion', 'Achieve level 5 in all Digital Governance competencies', '🛡️', 'gold', '{"type": "domain_mastery", "domain": "Digital Governance", "value": 5}'::jsonb, 500),
('CAREER_PROMO', 'Career Catalyst', 'Promote to next career level', '🚀', 'platinum', '{"type": "career_promotion", "value": 1}'::jsonb, 1000),
('CERT_5', 'Certified Professional', 'Earn 5 certificates', '🏅', 'silver', '{"type": "certificates", "value": 5}'::jsonb, 200)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 7. RECOMMENDATION EXPLANATIONS (XAI)
-- ============================================
CREATE TABLE IF NOT EXISTS public.recommendation_explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  explanation TEXT NOT NULL, -- human-readable "why"
  factors JSONB, -- [{"factor": "addresses_gap", "weight": 0.8, "detail": "..."}]
  algorithm TEXT, -- 'content', 'collaborative', 'rule_based', 'hybrid'
  confidence NUMERIC(3,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.recommendation_explanations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own explanations" ON public.recommendation_explanations;
CREATE POLICY "Users read own explanations" ON public.recommendation_explanations FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- 8. COURSE COMPLETION FEEDBACK (for retraining)
-- ============================================
CREATE TABLE IF NOT EXISTS public.learning_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL, -- 'started', 'progress', 'completed', 'quiz_score', 'rating', 'ojt_performance'
  signal_value NUMERIC, -- e.g., quiz_score=85, progress=0.6
  signal_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_user ON public.learning_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_signals_course ON public.learning_signals(course_id);
CREATE INDEX IF NOT EXISTS idx_signals_type ON public.learning_signals(signal_type);

ALTER TABLE public.learning_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own signals" ON public.learning_signals;
CREATE POLICY "Users read own signals" ON public.learning_signals FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own signals" ON public.learning_signals;
CREATE POLICY "Users insert own signals" ON public.learning_signals FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 9. WORKFORCE FORECASTS (predictive analytics)
-- ============================================
CREATE TABLE IF NOT EXISTS public.workforce_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL,
  competency_id UUID REFERENCES public.competencies(id) ON DELETE CASCADE,
  forecast_horizon_months INT, -- 12 or 24
  current_supply NUMERIC, -- officials with this skill
  current_demand NUMERIC, -- needed for roadmap
  predicted_demand NUMERIC, -- future need
  predicted_shortage NUMERIC, -- gap
  confidence NUMERIC(3,2),
  drivers JSONB, -- ["retirement_wave", "tech_adoption", "policy_change"]
  generated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.workforce_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read forecasts" ON public.workforce_forecasts;
CREATE POLICY "Public read forecasts" ON public.workforce_forecasts FOR SELECT USING (true);

-- ============================================
-- 10. QUESTIONS: ENHANCED FOR IRT + BLOOM + MULTILINGUAL
-- ============================================
DO $$ BEGIN
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS competency_id UUID REFERENCES public.competencies(id) ON DELETE CASCADE;
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE;
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS embedding VECTOR(768);
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS source TEXT;
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS content_hash TEXT; -- for duplicate detection
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS irt_a NUMERIC(3,2) DEFAULT 1.0; -- discrimination
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS irt_b NUMERIC(5,2) DEFAULT 0.0; -- difficulty
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS irt_c NUMERIC(3,2) DEFAULT 0.0; -- guessing
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS times_asked INT DEFAULT 0;
  ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS times_correct INT DEFAULT 0;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_questions_hash ON public.questions(content_hash);
CREATE INDEX IF NOT EXISTS idx_questions_lang ON public.questions(language);

-- ============================================
-- 11. LIVE QUIZ SESSIONS (WebRTC AI examiner)
-- ============================================
CREATE TABLE IF NOT EXISTS public.live_quiz_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  language TEXT DEFAULT 'en',
  difficulty NUMERIC(3,2) DEFAULT 0.0,
  status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'abandoned'
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_questions INT DEFAULT 0,
  correct_answers INT DEFAULT 0,
  final_score NUMERIC(5,2),
  transcript JSONB DEFAULT '[]'::jsonb,
  violations JSONB DEFAULT '[]'::jsonb, -- anti-cheat events
  session_metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_live_quiz_user ON public.live_quiz_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_live_quiz_course ON public.live_quiz_sessions(course_id);

ALTER TABLE public.live_quiz_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own live_quiz" ON public.live_quiz_sessions;
CREATE POLICY "Users read own live_quiz" ON public.live_quiz_sessions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own live_quiz" ON public.live_quiz_sessions;
CREATE POLICY "Users insert own live_quiz" ON public.live_quiz_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own live_quiz" ON public.live_quiz_sessions;
CREATE POLICY "Users update own live_quiz" ON public.live_quiz_sessions FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- 12. SIGNED CERTIFICATES (blockchain-ready)
-- ============================================
DO $$ BEGIN
  ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS signature TEXT;
  ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS signature_algorithm TEXT DEFAULT 'RSA-SHA256';
  ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS blockchain_hash TEXT;
  ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS qr_code_url TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================
-- 13. AUDIT LOG (compliance + GIGW)
-- ============================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No public audit access" ON public.audit_logs;
CREATE POLICY "No public audit access" ON public.audit_logs FOR SELECT USING (false);

-- ============================================
-- 14. ADD NSSTA_TPAC EXTERNAL URL HELPER
-- ============================================
DO $$ BEGIN
  ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS source_url TEXT;
  ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
  ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS difficulty TEXT;
  ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS credits NUMERIC(4,1) DEFAULT 0;
  ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS instructor TEXT;
  ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================
-- 15. USER POINTS / LEADERBOARD
-- ============================================
DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_points INT DEFAULT 0;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS current_streak_days INT DEFAULT 0;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS longest_streak_days INT DEFAULT 0;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS career_level TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================
-- 16. VERIFY
-- ============================================
SELECT 'job_roles: ' || COUNT(*) AS count FROM public.job_roles;
SELECT 'badges: ' || COUNT(*) AS count FROM public.badges;
