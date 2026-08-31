-- RPC Functions for SkillUp v3
-- Run in Supabase SQL Editor

-- Increment competency score
CREATE OR REPLACE FUNCTION increment_competency_score(
  p_user_id UUID,
  p_competency_id UUID,
  p_increase NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_competency_scores
  SET current_score = LEAST(5.0, current_score + p_increase),
      updated_at = NOW()
  WHERE user_id = p_user_id AND competency_id = p_competency_id;
  
  IF NOT FOUND THEN
    INSERT INTO user_competency_scores (user_id, competency_id, current_score, required_score)
    VALUES (p_user_id, p_competency_id, LEAST(5.0, 1.0 + p_increase), 4.0);
  END IF;
END;
$$;

-- Increment total points
CREATE OR REPLACE FUNCTION increment_total_points(x INT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- No-op placeholder - handled in service layer
END;
$$;

-- Search courses by text (full text search)
CREATE OR REPLACE FUNCTION search_courses(query TEXT)
RETURNS TABLE(
  id UUID,
  title TEXT,
  description TEXT,
  provider TEXT,
  duration_hours NUMERIC,
  source TEXT,
  similarity REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.title,
    c.description,
    c.provider,
    c.duration_hours,
    c.source,
    ts_rank(to_tsvector('english', c.title || ' ' || COALESCE(c.description, '')), plainto_tsquery('english', query)) AS similarity
  FROM courses c
  WHERE to_tsvector('english', c.title || ' ' || COALESCE(c.description, '')) @@ plainto_tsquery('english', query)
  ORDER BY similarity DESC
  LIMIT 20;
END;
$$;

-- Get user learning stats
CREATE OR REPLACE FUNCTION get_user_learning_stats(p_user_id UUID)
RETURNS TABLE(
  total_courses INT,
  completed_courses INT,
  in_progress_courses INT,
  total_learning_hours NUMERIC,
  certificates_earned INT,
  average_quiz_score NUMERIC,
  current_streak INT,
  total_points INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(e.id)::INT AS total_courses,
    COUNT(CASE WHEN e.status = 'completed' THEN 1 END)::INT AS completed_courses,
    COUNT(CASE WHEN e.status = 'in_progress' THEN 1 END)::INT AS in_progress_courses,
    COALESCE(SUM(c.duration_hours), 0)::NUMERIC AS total_learning_hours,
    (SELECT COUNT(*) FROM certificates WHERE user_id = p_user_id)::INT AS certificates_earned,
    COALESCE(AVG(a.auto_score), 0)::NUMERIC AS average_quiz_score,
    COALESCE(p.current_streak_days, 0)::INT AS current_streak,
    COALESCE(p.total_points, 0)::INT AS total_points
  FROM course_enrollments e
  JOIN courses c ON e.course_id = c.id
  JOIN profiles p ON p.id = e.user_id
  LEFT JOIN assessment_attempts a ON a.user_id = e.user_id AND a.course_id = e.course_id
  WHERE e.user_id = p_user_id
  GROUP BY p.current_streak_days, p.total_points;
END;
$$;
