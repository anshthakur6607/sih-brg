-- Courses & Related Tables for SkillUp
-- Run this in Supabase SQL Editor

-- ============================================
-- Course Source Enum (if not exists)
-- ============================================
DO $$ BEGIN
  CREATE TYPE course_source AS ENUM ('iGOT', 'NSSTA_TPAC', 'MoSPI_Internal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- Courses Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT DEFAULT 'iGOT',
  external_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  provider TEXT,
  duration_hours NUMERIC(5,1),
  course_url TEXT,
  is_tpac_classroom BOOLEAN DEFAULT false,
  tpac_start_date DATE,
  tpac_location TEXT,
  target_competencies JSONB DEFAULT '[]'::jsonb,
  delivery_mode TEXT DEFAULT 'Self-Paced Online',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- RLS for Courses (public read)
-- ============================================
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read courses" ON public.courses;
CREATE POLICY "Public read courses" ON public.courses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role courses" ON public.courses;
CREATE POLICY "Service role courses" ON public.courses FOR ALL USING (true) WITH CHECK (true);

-- Needed for ON CONFLICT (title, provider) in seeds
CREATE UNIQUE INDEX IF NOT EXISTS courses_title_provider_unique ON public.courses (title, provider);

-- ============================================
-- Assessment Attempts Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id),
  auto_score NUMERIC(5,2),
  passed BOOLEAN DEFAULT false,
  tab_switch_count INT DEFAULT 0,
  fullscreen_exits INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending'
);

ALTER TABLE public.assessment_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own attempts" ON public.assessment_attempts;
CREATE POLICY "Users read own attempts" ON public.assessment_attempts FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own attempts" ON public.assessment_attempts;
CREATE POLICY "Users insert own attempts" ON public.assessment_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own attempts" ON public.assessment_attempts;
CREATE POLICY "Users update own attempts" ON public.assessment_attempts FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- Questions Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id UUID REFERENCES public.competencies(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer INT NOT NULL,
  bloom_level TEXT,
  difficulty_beta NUMERIC(5,2) DEFAULT 0.0,
  explanation TEXT
);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read questions" ON public.questions;
CREATE POLICY "Public read questions" ON public.questions FOR SELECT USING (true);

-- ============================================
-- Competency Scores Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_competency_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  competency_id UUID REFERENCES public.competencies(id) ON DELETE CASCADE,
  current_score NUMERIC(5,2) DEFAULT 0.0,
  required_score NUMERIC(5,2) DEFAULT 4.00,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, competency_id)
);

ALTER TABLE public.user_competency_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own scores" ON public.user_competency_scores;
CREATE POLICY "Users read own scores" ON public.user_competency_scores FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own scores" ON public.user_competency_scores;
CREATE POLICY "Users insert own scores" ON public.user_competency_scores FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own scores" ON public.user_competency_scores;
CREATE POLICY "Users update own scores" ON public.user_competency_scores FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- Competencies Table (if not exists)
-- ============================================
CREATE TABLE IF NOT EXISTS public.competencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID REFERENCES public.competency_domains(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  UNIQUE(domain_id, name)
);

-- ============================================
-- Seed: iGOT Online Courses
-- ============================================
INSERT INTO public.courses (title, description, provider, duration_hours, source, course_url, target_competencies) VALUES
('Introduction to Survey Sampling', 'Learn the fundamentals of survey sampling methodology including simple random sampling, stratified sampling, and cluster sampling.', 'LBSNAA', 8, 'iGOT', 'https://courses.igot.gov.in', '["Survey Sampling", "Sample Design", "Data Collection"]'),
('Data Quality Assurance', 'Master techniques for ensuring data quality in government surveys including validation, imputation, and quality control.', 'NSSTA', 6, 'iGOT', 'https://courses.igot.gov.in', '["Data Quality", "Statistical Analysis"]'),
('National Accounts Methodology', 'Understanding System of National Accounts (SNA) frameworks and GDP computation methods.', 'CSO', 10, 'iGOT', 'https://courses.igot.gov.in', '["National Accounts", "Statistical Analysis"]'),
('SDG Indicators Training', 'Measuring and reporting on Sustainable Development Goals (SDGs) with focus on Indian context.', 'MoSPI', 8, 'iGOT', 'https://courses.igot.gov.in', '["SDG Indicators", "Data Quality", "Data Collection"]'),
('Census Operations Overview', 'Comprehensive training on census methodology and operations in India.', 'MoSPI', 12, 'iGOT', 'https://courses.igot.gov.in', '["Census Operations", "Survey Sampling", "Data Collection"]'),
('Python for Data Analysis', 'Introduction to Python programming for statistical analysis and data manipulation using pandas and numpy.', 'DIID', 12, 'iGOT', 'https://courses.igot.gov.in', '["Python", "Data Visualization"]'),
('R for Statistics', 'Statistical computing using R programming language for government data analysis.', 'NSSTA', 10, 'iGOT', 'https://courses.igot.gov.in', '["R", "Statistical Analysis", "Data Visualization"]'),
('SQL for Government Data', 'Database querying and management using SQL for official statistics.', 'DIID', 8, 'iGOT', 'https://courses.igot.gov.in', '["SQL", "Database Management"]'),
('GIS Applications in Governance', 'Geographic Information Systems for spatial analysis and mapping in government.', 'DIID', 8, 'iGOT', 'https://courses.igot.gov.in', '["GIS", "Data Visualization"]'),
('Introduction to AI/ML', 'Overview of artificial intelligence and machine learning for government applications.', 'DIID', 6, 'iGOT', 'https://courses.igot.gov.in', '["AI/ML", "Data Analysis"]'),
('Data Privacy and Security', 'Protecting sensitive government data and understanding data protection regulations.', 'NIC', 4, 'iGOT', 'https://courses.igot.gov.in', '["Data Privacy", "Cybersecurity"]'),
('Cybersecurity Fundamentals', 'Essential cybersecurity practices for government officials.', 'NIC', 6, 'iGOT', 'https://courses.igot.gov.in', '["Cybersecurity", "Data Privacy"]'),
('Digital India Initiative', 'Overview of Digital India program and its implementation.', 'MeitY', 4, 'iGOT', 'https://courses.igot.gov.in', '["DPI", "e-Governance", "Digital Infrastructure"]'),
('GovCloud Essentials', 'Understanding government cloud computing infrastructure and services.', 'NIC', 4, 'iGOT', 'https://courses.igot.gov.in', '["Govt Cloud", "Digital Infrastructure"]'),
('Leadership Skills for Managers', 'Developing leadership capabilities for senior government officials.', 'LBSNAA', 6, 'iGOT', 'https://courses.igot.gov.in', '["Leadership", "Team Management", "Decision Making"]'),
('Effective Communication', 'Enhancing communication skills for government professionals.', 'LBSNAA', 4, 'iGOT', 'https://courses.igot.gov.in', '["Communication", "Problem Solving"]'),
('Ethics in Public Service', 'Understanding ethical principles and code of conduct for civil servants.', 'LBSNAA', 4, 'iGOT', 'https://courses.igot.gov.in', '["Ethics"]'),
('Change Management', 'Managing organizational change and transformation in government.', 'LBSNAA', 4, 'iGOT', 'https://courses.igot.gov.in', '["Change Management", "Leadership"]'),
('Project Management', 'Essential project management skills for government projects.', 'DIID', 6, 'iGOT', 'https://courses.igot.gov.in', '["Time Management", "Problem Solving", "Decision Making"]'),
('Open Data and Data Sharing', 'Principles and practices of open data in government for transparency.', 'MoSPI', 4, 'iGOT', 'https://courses.igot.gov.in', '["Open Data", "Data Visualization"]')
ON CONFLICT (title, provider) DO NOTHING;

-- ============================================
-- Seed: NSSTA TPAC Classroom Sessions
-- ============================================
INSERT INTO public.courses (title, description, provider, duration_hours, source, is_tpac_classroom, tpac_start_date, tpac_location, course_url, target_competencies) VALUES
('Advanced Statistical Methods', 'In-depth training on advanced statistical techniques including multivariate analysis, time series, and econometrics.', 'NSSTA', 40, 'NSSTA_TPAC', true, '2026-04-15', 'NSSTA, Greater Noida', 'https://nssta.gov.in', '["Statistical Analysis", "Data Analysis"]'),
('Data Science Workshop', 'Hands-on workshop on data science applications using Python, machine learning, and big data technologies.', 'NSSTA', 24, 'NSSTA_TPAC', true, '2026-05-20', 'NSSTA, Greater Noida', 'https://nssta.gov.in', '["Python", "AI/ML", "Data Visualization"]'),
('GIS Advanced Training', 'Advanced GIS training for spatial analysis, remote sensing, and mapping applications.', 'NSSTA', 32, 'NSSTA_TPAC', true, '2026-06-10', 'NSSTA, Greater Noida', 'https://nssta.gov.in', '["GIS", "Data Visualization"]'),
('Survey Design and Analysis', 'Comprehensive training on designing and analyzing household and establishment surveys.', 'NSSTA', 36, 'NSSTA_TPAC', true, '2026-07-15', 'NSSTA, Greater Noida', 'https://nssta.gov.in', '["Survey Sampling", "Sample Design", "Statistical Analysis"]'),
('National Accounts Advanced', 'Advanced topics in national accounts including satellite accounts, informal sector estimation.', 'NSSTA', 28, 'NSSTA_TPAC', true, '2026-08-20', 'NSSTA, Greater Noida', 'https://nssta.gov.in', '["National Accounts", "Statistical Analysis"]'),
('Data Quality Management', 'Training on data quality frameworks, validation techniques, and quality assurance.', 'NSSTA', 20, 'NSSTA_TPAC', true, '2026-09-10', 'NSSTA, Greater Noida', 'https://nssta.gov.in', '["Data Quality", "Database Management"]')
ON CONFLICT (title, provider) DO NOTHING;

-- ============================================
-- Seed: MoSPI Official Courses
-- ============================================
INSERT INTO public.courses (title, description, provider, duration_hours, source, course_url, target_competencies) VALUES
('MoSPI Data Portal Orientation', 'Training on using the MoSPI data portal for accessing official statistics and reports.', 'MoSPI', 3, 'MoSPI_Internal', 'https://mospi.gov.in', '["Open Data", "Data Visualization"]'),
('Index of Industrial Production', 'Understanding IIP computation, base year revision, and data collection methodology.', 'MoSPI', 5, 'MoSPI_Internal', 'https://mospi.gov.in', '["Statistical Analysis", "Data Collection"]'),
('Consumer Price Index Training', 'CPI computation methodology, basket revision, and price data collection.', 'MoSPI', 6, 'MoSPI_Internal', 'https://mospi.gov.in', '["Statistical Analysis", "Data Quality"]'),
('GDP Estimation Methodology', 'Quarterly and annual GDP estimation procedures using the expenditure and production approach.', 'MoSPI', 8, 'MoSPI_Internal', 'https://mospi.gov.in', '["National Accounts", "Statistical Analysis"]'),
('Annual Survey of Industries', 'Understanding ASI methodology, data processing, and result compilation.', 'MoSPI', 6, 'MoSPI_Internal', 'https://mospi.gov.in', '["Survey Sampling", "Data Collection", "National Accounts"]'),
('Household Consumer Expenditure Survey', 'Training on HCES methodology, questionnaire design, and data analysis.', 'MoSPI', 8, 'MoSPI_Internal', 'https://mospi.gov.in', '["Survey Sampling", "Data Collection"]')
ON CONFLICT (title, provider) DO NOTHING;

-- Questions are NOT seeded here — they are AI-generated per-user and saved to S3 (quizzes/{user_id}/{quiz_id}.json)
-- with RLS only owner can see. See backend/src/routes/ai.ts and ai-service/routers/quiz_gen.py
-- ============================================
-- Verify
-- ============================================
SELECT 'courses: ' || COUNT(*) AS count FROM public.courses;
