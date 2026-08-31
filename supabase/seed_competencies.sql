-- Seed competencies from survey keys + course target_competencies
-- Run in Supabase SQL Editor

-- Ensure all 4 domains exist
INSERT INTO public.competency_domains (name) VALUES
  ('Statistical'),
  ('Technical'),
  ('Digital Governance'),
  ('Behavioural')
ON CONFLICT (name) DO NOTHING;

-- Seed competencies with domain assignment
-- (Survey uses snake_case keys; courses use Title Case names)
INSERT INTO public.competencies (domain_id, name)
SELECT d.id, c.name
FROM (VALUES
  -- Statistical domain
  ('Statistical', 'Statistical Analysis'),
  ('Statistical', 'Survey Sampling'),
  ('Statistical', 'National Accounts'),
  ('Statistical', 'SDG Indicators'),
  ('Statistical', 'Index Numbers'),
  ('Statistical', 'Data Quality'),
  ('Statistical', 'Data Collection'),
  -- Technical domain
  ('Technical', 'Data Visualization'),
  ('Technical', 'Data Analysis'),
  ('Technical', 'Database Management'),
  ('Technical', 'Machine Learning'),
  ('Technical', 'GIS & Spatial Analysis'),
  -- Digital Governance
  ('Digital Governance', 'Digital Governance'),
  ('Digital Governance', 'E-Governance'),
  ('Digital Governance', 'Cyber Security'),
  ('Digital Governance', 'Policy Analysis'),
  -- Behavioural
  ('Behavioural', 'Leadership'),
  ('Behavioural', 'Communication'),
  ('Behavioural', 'Team Building'),
  ('Behavioural', 'Decision Making')
) AS c(domain_name, name)
JOIN public.competency_domains d ON d.name = c.domain_name
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT d.name AS domain, COUNT(c.id) AS competencies
FROM public.competency_domains d
LEFT JOIN public.competencies c ON c.domain_id = d.id
GROUP BY d.name
ORDER BY d.name;

SELECT COUNT(*) AS total_competencies FROM public.competencies;
