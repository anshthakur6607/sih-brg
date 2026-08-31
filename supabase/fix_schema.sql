-- Minimal SkillUp Schema for Supabase SQL Editor
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run

-- Profiles Table (core table needed for registration & login)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'learner',
  designation VARCHAR(150) NOT NULL,
  department VARCHAR(150) NOT NULL,
  ministry VARCHAR(100) DEFAULT 'MoSPI',
  organization_level VARCHAR(50) DEFAULT 'Central',
  current_assignment TEXT,
  education TEXT,
  years_experience NUMERIC(4,1),
  preferred_language TEXT DEFAULT 'en',
  voice_navigation_enabled BOOLEAN DEFAULT true,
  consent_given BOOLEAN DEFAULT false,
  consent_timestamp TIMESTAMPTZ,
  experience_years INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Competency Domains (4 mandated domains)
CREATE TABLE IF NOT EXISTS public.competency_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE
);

-- Competencies
CREATE TABLE IF NOT EXISTS public.competencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID REFERENCES public.competency_domains(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL
);

-- User Competency Scores
CREATE TABLE IF NOT EXISTS public.user_competency_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  competency_id UUID REFERENCES public.competencies(id) ON DELETE CASCADE,
  current_score NUMERIC(5,2) DEFAULT 0.0,
  required_score NUMERIC(5,2) DEFAULT 4.00,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, competency_id)
);

-- Enable Row Level Security (RLS) on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- RLS Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- RLS Policy: Service role can do everything
CREATE POLICY "Service role full access"
  ON public.profiles FOR ALL
  USING (true)
  WITH CHECK (true);

-- RLS Policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policy: Users can delete their own profile
CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- Insert the 4 mandated competency domains
INSERT INTO public.competency_domains (name) VALUES
  ('Statistical'),
  ('Technical'),
  ('Digital Governance'),
  ('Behavioural')
ON CONFLICT (name) DO NOTHING;
