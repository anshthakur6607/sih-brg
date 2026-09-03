-- Per-user question bank support for the quiz generator.
-- Run this once in the Supabase SQL editor.

-- Ensure base table exists first (for fresh DBs where seed_courses.sql was never run)
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='questions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'user_id') THEN
    ALTER TABLE public.questions ADD COLUMN user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='questions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'source') THEN
    ALTER TABLE public.questions ADD COLUMN source TEXT DEFAULT 'manual';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='questions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'course_id') THEN
    ALTER TABLE public.questions ADD COLUMN course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_questions_user_id ON public.questions(user_id);
CREATE INDEX IF NOT EXISTS idx_questions_user_course ON public.questions(user_id, course_id);
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own questions" ON public.questions;
CREATE POLICY "Users read own questions" ON public.questions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own questions" ON public.questions;
CREATE POLICY "Users insert own questions" ON public.questions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own questions" ON public.questions;
CREATE POLICY "Users update own questions" ON public.questions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own questions" ON public.questions;
CREATE POLICY "Users delete own questions" ON public.questions FOR DELETE USING (auth.uid() = user_id);
