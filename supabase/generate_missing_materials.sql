-- Generate placeholder study material + PDF for every course missing one
-- Run in Supabase SQL Editor: ensures all courses are testable for Course AI / Live Tutor / Quiz
INSERT INTO public.course_materials (course_id, title, type, url, storage_path, content_text, duration_minutes, language, metadata)
SELECT
  c.id,
  'Study Material: ' || c.title,
  'pdf',
  'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
  'generated/' || c.id || '.pdf',
  'Study Material for ' || c.title || E'\n\n' || COALESCE(c.description,'') || E'\n\n---\nThis auto-generated material covers key concepts, definitions, MoSPI/NSSTA guidelines, and practice exercises for ' || c.title || '. Use it to chat with Course AI, generate practice questions, and power the Live Voice Tutor.\n\nKey topics:\n- Overview of ' || c.title || E'\n- Core principles and methodology\n- Recent MoSPI/NSSTA guidelines\n- Example case studies\n- 5 practice questions with answers\n',
  30,
  'en',
  '{"auto_generated": true}'::jsonb
FROM public.courses c
LEFT JOIN public.course_materials cm ON cm.course_id = c.id
WHERE cm.id IS NULL;

SELECT 'Generated ' || COUNT(*) || ' missing materials' AS result FROM public.course_materials WHERE metadata->>'auto_generated'='true';
-- Verify: expect 0 missing after run
SELECT COUNT(*) AS courses_without_material FROM public.courses c LEFT JOIN public.course_materials cm ON cm.course_id=c.id WHERE cm.id IS NULL;
