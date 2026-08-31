-- ============================================
-- Fix: Quizzes per-user S3 storage (no seeded questions)
-- Run in Supabase SQL Editor AFTER seed_courses
-- ============================================

-- 1. Add per-user columns to questions (must exist before DELETE)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='questions' AND column_name='user_id') THEN
    ALTER TABLE public.questions ADD COLUMN user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='questions' AND column_name='s3_key') THEN
    ALTER TABLE public.questions ADD COLUMN s3_key TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='questions' AND column_name='quiz_id') THEN
    ALTER TABLE public.questions ADD COLUMN quiz_id UUID DEFAULT gen_random_uuid();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='questions' AND column_name='language') THEN
    ALTER TABLE public.questions ADD COLUMN language TEXT DEFAULT 'en';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='questions' AND column_name='source') THEN
    ALTER TABLE public.questions ADD COLUMN source TEXT DEFAULT 'ai_generated';
  END IF;
END $$;

-- 2. Remove any seeded public questions (now per-user only) — safe after column exists
DELETE FROM public.questions WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_questions_user ON public.questions(user_id);
CREATE INDEX IF NOT EXISTS idx_questions_quiz ON public.questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_questions_s3 ON public.questions(s3_key);

-- 3. Fix RLS: only owner can see their quizzes
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read questions" ON public.questions;
DROP POLICY IF EXISTS "Users read own quizzes" ON public.questions;
CREATE POLICY "Users read own quizzes" ON public.questions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own quizzes" ON public.questions;
CREATE POLICY "Users insert own quizzes" ON public.questions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own quizzes" ON public.questions;
CREATE POLICY "Users update own quizzes" ON public.questions FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own quizzes" ON public.questions;
CREATE POLICY "Users delete own quizzes" ON public.questions FOR DELETE USING (auth.uid() = user_id);
-- Service role bypass (for backend AI generation)
DROP POLICY IF EXISTS "Service role questions" ON public.questions;
CREATE POLICY "Service role questions" ON public.questions FOR ALL USING (true) WITH CHECK (true);

-- 4. Create user_quizzes table for S3 metadata (one row per generated quiz)
CREATE TABLE IF NOT EXISTS public.user_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  s3_key TEXT NOT NULL, -- e.g. quizzes/{user_id}/{id}.json
  question_count INT NOT NULL,
  bloom_levels TEXT[] DEFAULT '{}',
  difficulty NUMERIC DEFAULT 0,
  language TEXT DEFAULT 'en',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(s3_key)
);
CREATE INDEX IF NOT EXISTS idx_user_quizzes_user ON public.user_quizzes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_quizzes_course ON public.user_quizzes(course_id);
ALTER TABLE public.user_quizzes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own user_quizzes" ON public.user_quizzes;
CREATE POLICY "Users read own user_quizzes" ON public.user_quizzes FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own user_quizzes" ON public.user_quizzes;
CREATE POLICY "Users insert own user_quizzes" ON public.user_quizzes FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own user_quizzes" ON public.user_quizzes;
CREATE POLICY "Users delete own user_quizzes" ON public.user_quizzes FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service role user_quizzes" ON public.user_quizzes;
CREATE POLICY "Service role user_quizzes" ON public.user_quizzes FOR ALL USING (true) WITH CHECK (true);

-- 5. Ensure storage bucket for quizzes exists (Supabase Storage)
-- Note: create via Dashboard > Storage > New bucket: "quizzes" (private), or via SQL if storage schema exists
-- The bucket RLS will be: only owner can read/write quizzes/{user_id}/*
DO $$ BEGIN
  INSERT INTO storage.buckets (id, name, public) VALUES ('quizzes', 'quizzes', false)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'storage.buckets not accessible — create bucket "quizzes" (private) manually in Dashboard';
END $$;

-- 6. Verify
SELECT 'questions (should be 0 after cleanup): ' || COUNT(*) FROM public.questions;
SELECT 'user_quizzes: ' || COUNT(*) FROM public.user_quizzes;
SELECT 'course_materials cols: ' || string_agg(column_name, ', ') FROM information_schema.columns WHERE table_name='course_materials';
