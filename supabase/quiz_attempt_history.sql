-- ============================================
-- Generated Quiz Attempt History (one-time setup)
-- Run in Supabase SQL Editor (Dashboard > SQL).
-- Stores every submitted quiz-generator attempt: full questions snapshot,
-- user's selected answers, marks and score — shown in the History tab.
-- Safe to re-run (IF NOT EXISTS + DROP POLICY IF EXISTS).
-- ============================================

CREATE TABLE IF NOT EXISTS public.generated_quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Generated Quiz',
  language TEXT DEFAULT 'en',
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  correct_count INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gen_quiz_attempts_user ON public.generated_quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_gen_quiz_attempts_created ON public.generated_quiz_attempts(created_at DESC);

ALTER TABLE public.generated_quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own quiz attempts" ON public.generated_quiz_attempts;
CREATE POLICY "Users read own quiz attempts" ON public.generated_quiz_attempts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own quiz attempts" ON public.generated_quiz_attempts;
CREATE POLICY "Users insert own quiz attempts" ON public.generated_quiz_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role quiz attempts" ON public.generated_quiz_attempts;
CREATE POLICY "Service role quiz attempts" ON public.generated_quiz_attempts
  FOR ALL USING (true) WITH CHECK (true);

-- Verify
SELECT 'generated_quiz_attempts ready' AS status;
