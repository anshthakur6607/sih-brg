-- ============================================
-- Survey Table Fix + Job Roles Seed
-- Run in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. RECREATE surveys TABLE WITH CORRECT SCHEMA
--    (drop and recreate to avoid alter-type issues)
-- ============================================

-- Drop existing table (RLS policies auto-drop with table)
DROP TABLE IF EXISTS public.surveys CASCADE;

-- Recreate with correct schema (role_id is TEXT, not UUID FK)
CREATE TABLE public.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id TEXT, -- nullable TEXT (not FK) so frontend can send role code strings
  current_designation TEXT,
  years_experience NUMERIC DEFAULT 0,
  education_level TEXT,
  familiarity_scores JSONB DEFAULT '{}'::jsonb,
  learning_goals TEXT[] DEFAULT '{}',
  preferred_modality TEXT DEFAULT 'self_paced',
  preferred_language TEXT DEFAULT 'en',
  time_availability TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "surveys_select_own" ON public.surveys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "surveys_insert_own" ON public.surveys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "surveys_update_own" ON public.surveys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "surveys_delete_own" ON public.surveys FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 2. JOB ROLES TABLE + RLS + SEED DATA
-- ============================================

DROP TABLE IF EXISTS public.job_roles CASCADE;

CREATE TABLE public.job_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  department TEXT,
  level TEXT,
  required_competencies JSONB DEFAULT '[]'::jsonb,
  mandatory_trainings JSONB DEFAULT '[]'::jsonb,
  career_progression JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_roles_read_all" ON public.job_roles FOR SELECT USING (true);

-- Seed 16 government + iGOT roles
INSERT INTO public.job_roles (code, title, description, department, level, required_competencies, mandatory_trainings) VALUES
('NSSO_INV', 'NSSO Investigator', 'Field investigator for NSSO surveys and data collection', 'NSSO', 'Group C', '["Survey Sampling", "Data Collection", "Data Quality", "Communication"]'::jsonb, '["Data Quality Assurance"]'::jsonb),
('NSSO_SO', 'NSSO Statistical Officer', 'Statistical officer managing NSSO field operations', 'NSSO', 'Group B', '["Survey Sampling", "Statistical Analysis", "Data Quality", "SQL"]'::jsonb, '["Data Quality Assurance"]'::jsonb),
('CSO_DIRECTOR', 'CSO Director', 'Director heading Central Statistics Office operations', 'CSO', 'Group A', '["National Accounts", "Statistical Analysis", "Leadership", "Decision Making"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('CSO_JOINT_DIR', 'CSO Joint Director', 'Joint Director in CSO', 'CSO', 'Group A', '["National Accounts", "Statistical Analysis", "Team Management", "Communication"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('CSO_DEPUTY_DIR', 'CSO Deputy Director', 'Deputy Director in CSO responsible for statistical production', 'CSO', 'Group A', '["National Accounts", "Statistical Analysis", "R", "Python"]'::jsonb, '["R for Statistics"]'::jsonb),
('DIID_SCIENTIST', 'DIID Data Scientist', 'Data Scientist in Data Innovation & Integration Division', 'DIID', 'Group A', '["Python", "AI/ML", "SQL", "Data Visualization", "Data Analysis"]'::jsonb, '["Python for Data Analysis", "Introduction to AI/ML"]'::jsonb),
('DIID_ANALYST', 'DIID Data Analyst', 'Data Analyst in DIID', 'DIID', 'Group B', '["Python", "SQL", "Data Visualization", "Statistical Analysis"]'::jsonb, '["SQL for Government Data"]'::jsonb),
('SDR_OFFICER', 'SDR Officer', 'Officer in Statistics Development & Regulation Division', 'SDR', 'Group B', '["Statistical Analysis", "Data Quality", "Communication", "Ethics"]'::jsonb, '["Ethics in Public Service"]'::jsonb),
('ESD_OFFICER', 'ESD Officer', 'Officer in Economic Statistics Division', 'ESD', 'Group B', '["Statistical Analysis", "National Accounts", "Data Collection"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('SSD_OFFICER', 'SSD Officer', 'Officer in Social Statistics Division', 'SSD', 'Group B', '["Statistical Analysis", "Census Operations", "Data Collection"]'::jsonb, '["Census Operations Overview"]'::jsonb),
('IGOT_LEARNER', 'iGOT Generic Learner', 'Generic learner enrolled on iGOT Karmayogi platform', 'iGOT', 'All Groups', '["Communication", "Ethics", "Time Management"]'::jsonb, '["Ethics in Public Service"]'::jsonb),
('FIELD_ENUMERATOR', 'Field Enumerator', 'Field enumerator for survey data collection', 'NSSO', 'Group C', '["Data Collection", "Survey Sampling", "Communication"]'::jsonb, '["Introduction to Survey Sampling"]'::jsonb),
('DISTRICT_OFFICER', 'District Statistical Officer', 'DSO managing district-level statistical operations', 'State DES', 'Group A', '["Leadership", "Data Collection", "Statistical Analysis", "Communication"]'::jsonb, '["Leadership Skills for Managers"]'::jsonb),
('STATE_DES_OFFICER', 'State DES Officer', 'Officer in State Directorate of Economics & Statistics', 'State DES', 'Group A', '["Statistical Analysis", "National Accounts", "Leadership"]'::jsonb, '["National Accounts Methodology"]'::jsonb),
('NIC_TECH', 'NIC Technical Officer', 'Technical officer in National Informatics Centre', 'NIC', 'Group B', '["Cybersecurity", "Data Privacy", "Python", "SQL"]'::jsonb, '["Cybersecurity Fundamentals"]'::jsonb),
('MEITY_OFFICER', 'MeitY Officer', 'Officer in Ministry of Electronics & Information Technology', 'MeitY', 'Group A', '["DPI", "e-Governance", "Cybersecurity", "Leadership"]'::jsonb, '["Digital India Initiative"]'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  department = EXCLUDED.department,
  level = EXCLUDED.level;

-- ============================================
-- 3. VERIFY
-- ============================================
SELECT 'surveys table: OK' AS status WHERE EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_name = 'surveys'
);
SELECT 'job_roles count: ' || COUNT(*) AS result FROM public.job_roles;
SELECT 'surveys columns: ' || column_name || ' (' || data_type || ')' 
FROM information_schema.columns 
WHERE table_name = 'surveys' 
ORDER BY ordinal_position;
