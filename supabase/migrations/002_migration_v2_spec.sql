-- MoSPI SkillUp Migration v2 - Complete Spec Schema (SIH 26101)
-- Execute AFTER 001_initial_schema.sql in Supabase SQL Editor
-- Adds tutor_sessions, final_assessments, certificates v2, and ensures spec compliance

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Competency Domains (spec: if not exists)
CREATE TABLE IF NOT EXISTS public.competency_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Competencies Master
CREATE TABLE IF NOT EXISTS public.competencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id UUID REFERENCES public.competency_domains(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    target_score NUMERIC(3,2) DEFAULT 4.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Profiles - spec variant (ensure columns)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    designation VARCHAR(150) NOT NULL,
    department VARCHAR(150) NOT NULL,
    current_assignment TEXT,
    education TEXT,
    experience_years INT DEFAULT 0,
    role VARCHAR(50) DEFAULT 'employee',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Add missing spec columns if table already existed from v1
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS experience_years INT DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS current_assignment TEXT;

-- User Competency Scores
CREATE TABLE IF NOT EXISTS public.user_competency_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    competency_id UUID REFERENCES public.competencies(id) ON DELETE CASCADE,
    current_score NUMERIC(3,2) DEFAULT 1.00,
    gap_score NUMERIC(3,2) GENERATED ALWAYS AS (4.00 - current_score) STORED,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, competency_id)
);

-- Courses Master (spec)
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    delivery_mode VARCHAR(50) NOT NULL DEFAULT 'Self-Paced Online',
    duration_hours INT NOT NULL DEFAULT 4,
    s3_materials_url TEXT,
    competency_id UUID REFERENCES public.competencies(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Ensure adapter compatibility columns
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'iGOT';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS is_tpac_classroom BOOLEAN DEFAULT false;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS tpac_start_date DATE;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS tpac_location TEXT;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS target_competencies JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS embedding VECTOR(768);
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(50) DEFAULT 'Self-Paced Online';
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS s3_materials_url TEXT;

-- WebRTC Live Tutor Sessions State Persistence
CREATE TABLE IF NOT EXISTS public.tutor_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    module_id VARCHAR(100) NOT NULL,
    last_timestamp INT DEFAULT 0,
    conversation_history JSONB DEFAULT '[]'::jsonb,
    summary_state TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, course_id, module_id)
);

-- Final Gatekeeper Assessments
CREATE TABLE IF NOT EXISTS public.final_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    score NUMERIC(5,2) NOT NULL,
    passing_score NUMERIC(5,2) DEFAULT 75.00,
    status VARCHAR(30) DEFAULT 'pending_admin_review',
    telemetry_summary JSONB DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin HITL Review Queue
CREATE TABLE IF NOT EXISTS public.assessment_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    final_assessment_id UUID REFERENCES public.final_assessments(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES public.profiles(id),
    decision VARCHAR(20) CHECK (decision IN ('approved','rejected')),
    admin_notes TEXT,
    reviewed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Verified Dual-Score Certificates
CREATE TABLE IF NOT EXISTS public.certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    verification_code VARCHAR(100) UNIQUE NOT NULL,
    raw_score NUMERIC(5,2) NOT NULL,
    competency_delta NUMERIC(3,2) NOT NULL DEFAULT 0.50,
    qr_code_url TEXT NOT NULL DEFAULT '',
    issued_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS competency_delta NUMERIC(3,2) DEFAULT 0.50;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS qr_code_url TEXT DEFAULT '';

-- Anti-cheat telemetry (detailed)
CREATE TABLE IF NOT EXISTS public.exam_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exam_telemetry_assessment ON exam_telemetry(assessment_id, user_id);

-- Questions table for quiz_gen
CREATE TABLE IF NOT EXISTS public.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    competency_id UUID REFERENCES public.competencies(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_answer INT NOT NULL,
    bloom_level TEXT NOT NULL DEFAULT 'remember',
    difficulty_beta DECIMAL(5,2) DEFAULT 0.0,
    explanation TEXT,
    language TEXT DEFAULT 'en',
    source_s3_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotency: unique indexes to allow ON CONFLICT in seed (re-runnable seed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_competencies_domain_name ON public.competencies(domain_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_title_provider ON public.courses(title, provider);
-- Questions unique on competency + text hash to avoid duplicate questions on re-seed
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_competency_text ON public.questions(competency_id, text);
