-- ============================================
-- Backfill competency → domain links (one-time setup)
-- Run in Supabase SQL Editor on the project your app actually reads.
-- Only fills rows where domain_id IS NULL; never overwrites existing links.
-- Fixes dashboard charts collapsing into "Unknown".
-- Safe to re-run.
-- ============================================

-- Statistical
UPDATE public.competencies SET domain_id = (SELECT id FROM public.competency_domains WHERE name = 'Statistical')
WHERE domain_id IS NULL AND name IN (
  'Statistical Analysis', 'Survey Sampling', 'National Accounts',
  'SDG Indicators', 'Index Numbers', 'Data Quality', 'Data Collection'
);

-- Technical
UPDATE public.competencies SET domain_id = (SELECT id FROM public.competency_domains WHERE name = 'Technical')
WHERE domain_id IS NULL AND name IN (
  'Data Visualization', 'Data Analysis', 'Database Management',
  'GIS & Spatial Analysis', 'Machine Learning'
);

-- Digital Governance
UPDATE public.competencies SET domain_id = (SELECT id FROM public.competency_domains WHERE name = 'Digital Governance')
WHERE domain_id IS NULL AND name IN (
  'Cyber Security', 'Digital Governance', 'E-Governance', 'Policy Analysis'
);

-- Behavioural
UPDATE public.competencies SET domain_id = (SELECT id FROM public.competency_domains WHERE name = 'Behavioural')
WHERE domain_id IS NULL AND name IN (
  'Communication', 'Decision Making', 'Leadership', 'Team Building'
);

-- Verify: expect 0 unlinked (NULL band) unless custom competencies were added
SELECT COALESCE(cd.name, '(UNLINKED)') AS domain, COUNT(*) AS competencies
FROM public.competencies c
LEFT JOIN public.competency_domains cd ON cd.id = c.domain_id
GROUP BY cd.name
ORDER BY competencies DESC;
