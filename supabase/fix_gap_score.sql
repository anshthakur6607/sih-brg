-- Fix: add gap_score column and backfill for recommendations
-- Run in Supabase SQL Editor
ALTER TABLE public.user_competency_scores ADD COLUMN IF NOT EXISTS gap_score NUMERIC(5,2);

-- Trigger to auto-maintain gap_score = required - current
CREATE OR REPLACE FUNCTION public.update_gap_score() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.gap_score := COALESCE(NEW.required_score, 4) - COALESCE(NEW.current_score, 0);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_update_gap_score ON public.user_competency_scores;
CREATE TRIGGER trg_update_gap_score
  BEFORE INSERT OR UPDATE OF current_score, required_score ON public.user_competency_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_gap_score();

-- Backfill existing rows
UPDATE public.user_competency_scores SET gap_score = COALESCE(required_score,4) - COALESCE(current_score,0) WHERE gap_score IS NULL;
SELECT 'gap_score fixed — ' || COUNT(*) || ' rows' AS result FROM public.user_competency_scores WHERE gap_score IS NOT NULL;
