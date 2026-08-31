-- SkillUp Database Migration - Initial Schema
-- Version: 001
-- Description: Creates all core tables, enums, indexes, and RLS policies

-- ============================================
-- Extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================
-- Enums
-- ============================================
CREATE TYPE user_role AS ENUM ('learner', 'manager', 'admin');
CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected', 'flagged');
CREATE TYPE bloom_level AS ENUM ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create');
CREATE TYPE course_source AS ENUM ('iGOT', 'NSSTA_TPAC', 'MoSPI_Internal');

-- ============================================
-- Profiles Table
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role user_role DEFAULT 'learner',
  designation TEXT NOT NULL,
  department TEXT NOT NULL,
  ministry TEXT DEFAULT 'MoSPI',
  organization_level TEXT DEFAULT 'Central',
  current_assignment TEXT,
  education TEXT,
  years_experience NUMERIC(4,1),
  preferred_language TEXT DEFAULT 'en',
  voice_navigation_enabled BOOLEAN DEFAULT true,
  consent_given BOOLEAN DEFAULT false,
  consent_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Competency Domains (4 Mandated)
-- ============================================
CREATE TABLE competency_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE
);

-- ============================================
-- Competencies
-- ============================================
CREATE TABLE competencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID REFERENCES competency_domains(id),
  name TEXT NOT NULL,
  embedding VECTOR(768)
);

-- ============================================
-- User Competency Scores
-- ============================================
CREATE TABLE user_competency_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  competency_id UUID REFERENCES competencies(id),
  current_score NUMERIC(5,2) DEFAULT 0.0,
  required_score NUMERIC(5,2) DEFAULT 4.00,
  gap_score NUMERIC(5,2) GENERATED ALWAYS AS (GREATEST(0, required_score - current_score)) STORED,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, competency_id)
);

-- ============================================
-- Courses
-- ============================================
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source course_source DEFAULT 'iGOT',
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
  embedding VECTOR(768),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Assessment Attempts
-- ============================================
CREATE TABLE assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id),
  auto_score NUMERIC(5,2),
  passed BOOLEAN DEFAULT false,
  tab_switch_count INT DEFAULT 0,
  fullscreen_exits INT DEFAULT 0,
  time_taken_seconds INT,
  telemetry_flags JSONB DEFAULT '[]'::jsonb,
  status review_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Assessment Reviews
-- ============================================
CREATE TABLE assessment_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  auto_score NUMERIC(5,2) NOT NULL,
  final_verified_score NUMERIC(5,2),
  review_status review_status DEFAULT 'pending',
  verified_by UUID REFERENCES profiles(id),
  admin_notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Certificates
-- ============================================
CREATE TABLE certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  course_id UUID REFERENCES courses(id),
  verification_code TEXT UNIQUE NOT NULL,
  auto_score NUMERIC(5,2) NOT NULL,
  verified_score NUMERIC(5,2) NOT NULL,
  signed_by_admin TEXT NOT NULL,
  issue_date TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Assessment Questions
-- ============================================
CREATE TABLE assessment_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competency_id UUID REFERENCES competencies(id),
  text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer INT NOT NULL,
  bloom_level bloom_level DEFAULT 'remember',
  difficulty NUMERIC(3,2) DEFAULT 0.0,
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_competency_scores_user ON user_competency_scores(user_id);
CREATE INDEX idx_competency_scores_competency ON user_competency_scores(competency_id);
CREATE INDEX idx_assessment_attempts_user ON assessment_attempts(user_id);
CREATE INDEX idx_assessment_attempts_course ON assessment_attempts(course_id);
CREATE INDEX idx_assessment_attempts_status ON assessment_attempts(status);
CREATE INDEX idx_certificates_user ON certificates(user_id);
CREATE INDEX idx_certificates_code ON certificates(verification_code);
CREATE INDEX idx_profiles_department ON profiles(department);
CREATE INDEX idx_profiles_role ON profiles(role);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_competency_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_questions ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
-- Simple: All users can manage their own profile (no admin role needed)
CREATE POLICY "Users manage own profile" ON profiles FOR ALL 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- User Competency Scores Policies
CREATE POLICY "Users view own scores" ON user_competency_scores FOR SELECT 
  USING (user_id = auth.uid());

CREATE POLICY "Users update own scores" ON user_competency_scores FOR UPDATE 
  USING (user_id = auth.uid());

CREATE POLICY "Admins view all scores" ON user_competency_scores FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager')));

-- Assessment Attempts Policies
CREATE POLICY "Users view own attempts" ON assessment_attempts FOR SELECT 
  USING (user_id = auth.uid());

CREATE POLICY "Users create attempts" ON assessment_attempts FOR INSERT 
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own attempts" ON assessment_attempts FOR UPDATE 
  USING (user_id = auth.uid());

CREATE POLICY "Admins view all attempts" ON assessment_attempts FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager')));

-- Certificates Policies
CREATE POLICY "Users view own certificates" ON certificates FOR SELECT 
  USING (user_id = auth.uid());

CREATE POLICY "Public verify certificates" ON certificates FOR SELECT 
  USING (true);

-- Courses - Public read
CREATE POLICY "Public read courses" ON courses FOR SELECT USING (true);

-- Competencies - Public read
CREATE POLICY "Public read competencies" ON competencies FOR SELECT USING (true);

-- Assessment Questions - Public read
CREATE POLICY "Public read questions" ON assessment_questions FOR SELECT USING (true);

-- ============================================
-- Functions
-- ============================================

-- Function to increment competency score
CREATE OR REPLACE FUNCTION increment_competency_score(
  p_user_id UUID,
  p_competency_id UUID,
  p_increase NUMERIC(5,2)
)
RETURNS VOID AS $$
BEGIN
  UPDATE user_competency_scores
  SET current_score = LEAST(5.0, current_score + p_increase),
      updated_at = NOW()
  WHERE user_id = p_user_id AND competency_id = p_competency_id;
END;
$$ LANGUAGE plpgsql;

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, designation, department, ministry)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    COALESCE(NEW.raw_user_meta_data->>'designation', 'Employee'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'General'),
    'MoSPI'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();