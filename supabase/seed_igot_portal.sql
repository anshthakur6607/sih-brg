-- ============================================
-- Seed: 4 iGOT Karmayogi Portal Courses (user provided)
-- Run in Supabase SQL Editor AFTER seed_courses.sql
-- ============================================

-- Ensure RLS allows public read (already in seed_courses, but idempotent)
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read courses" ON public.courses;
CREATE POLICY "Public read courses" ON public.courses FOR SELECT USING (true);

-- Fix ON CONFLICT: add unique on (title, provider) if missing, and keep external_id unique
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS courses_title_provider_unique ON public.courses (title, provider);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Insert 4 real iGOT portal courses (TOC IDs from user)
INSERT INTO public.courses (external_id, title, description, provider, duration_hours, source, course_url, target_competencies, delivery_mode)
VALUES
(
  'do_113853739744133120148',
  'Data-Driven Decision Making for Government Officials',
  'Learn to use data and evidence for effective decision making in government. Covers data interpretation, visualization, and case studies from MoSPI datasets.',
  'iGOT Karmayogi',
  6,
  'iGOT',
  'https://portal.igotkarmayogi.gov.in/public/toc/do_113853739744133120148/overview',
  '["Data Analysis", "Decision Making", "Data Visualization"]'::jsonb,
  'Self-Paced Online'
),
(
  'do_113473107400630272120',
  'Office Procedures and File Management',
  'Master government office procedures, noting, drafting, and file management as per Central Secretariat Manual of Office Procedure.',
  'iGOT Karmayogi',
  5,
  'iGOT',
  'https://portal.igotkarmayogi.gov.in/public/toc/do_113473107400630272120/overview',
  '["Office Procedure", "Communication", "Time Management"]'::jsonb,
  'Self-Paced Online'
),
(
  'do_1136364937253437441916',
  'Leadership Development for Civil Servants',
  'Develop leadership competencies for effective governance — team management, change leadership, and ethical decision making.',
  'iGOT Karmayogi',
  8,
  'iGOT',
  'https://portal.igotkarmayogi.gov.in/public/toc/do_1136364937253437441916/overview',
  '["Leadership", "Team Management", "Change Management", "Ethics"]'::jsonb,
  'Self-Paced Online'
),
(
  'do_113923174474121216195',
  'Effective Communication and Drafting Skills',
  'Enhance written and oral communication, drafting of official documents, and presentation skills for government officials.',
  'iGOT Karmayogi',
  4,
  'iGOT',
  'https://portal.igotkarmayogi.gov.in/public/toc/do_113923174474121216195/overview',
  '["Communication", "Drafting", "Problem Solving"]'::jsonb,
  'Self-Paced Online'
)
ON CONFLICT (external_id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  provider = EXCLUDED.provider,
  duration_hours = EXCLUDED.duration_hours,
  course_url = EXCLUDED.course_url,
  target_competencies = EXCLUDED.target_competencies;

-- Also patch existing seed_courses that were inserted without external_id: give them external_id so ON CONFLICT works next time
UPDATE public.courses SET external_id = 'seed-igot-' || lower(replace(title, ' ', '-')) WHERE external_id IS NULL AND source = 'iGOT';
UPDATE public.courses SET external_id = 'seed-tpac-' || lower(replace(title, ' ', '-')) WHERE external_id IS NULL AND source = 'NSSTA_TPAC';
UPDATE public.courses SET external_id = 'seed-mospi-' || lower(replace(title, ' ', '-')) WHERE external_id IS NULL AND source = 'MoSPI_Internal';

-- Ensure course_materials has correct v3 schema (do NOT recreate with wrong columns)
-- v3 defines: id, course_id, title, type, url, storage_path, content_text, duration_minutes, order_index, language, metadata, created_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_materials' AND column_name='type') THEN
    ALTER TABLE public.course_materials ADD COLUMN type TEXT DEFAULT 'web_link';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_materials' AND column_name='url') THEN
    ALTER TABLE public.course_materials ADD COLUMN url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_materials' AND column_name='storage_path') THEN
    ALTER TABLE public.course_materials ADD COLUMN storage_path TEXT;
  END IF;
END $$;

-- Add study materials for the 4 iGOT courses (used for quiz generation, RAG) — uses v3 columns with real PDFs
-- Data-Driven Decision Making
INSERT INTO public.course_materials (course_id, title, type, url, storage_path, content_text, language)
SELECT c.id, 'MeitY - Data-Driven Decision Making (28th COCSSO Plenary)', 'pdf', 'https://mospi.gov.in/sites/default/files/cocsso/Plenary%202_28th_COCSSO.pdf', 'course-materials/' || c.id || '/Plenary_28th_COCSSO.pdf',
  'Data is fundamental to digital governance. Quality data in collection/management drives DPI and AI. OGD, DigiLocker (30.78cr users), UMANG (2,039 services) enable data-driven governance. Capacity building via Future Skills Prime for AI/ML/Blockchain. DPDPA exempts statistical purposes. Quality culture: accuracy, timeliness, comparability, coherence.',
  'en'
FROM public.courses c WHERE c.external_id = 'do_113853739744133120148'
ON CONFLICT DO NOTHING;

-- Office Procedures - CSMOP 2022
INSERT INTO public.course_materials (course_id, title, type, url, storage_path, content_text, language)
SELECT c.id, 'CSMOP 2022 - Central Secretariat Manual of Office Procedure (16th Edition)', 'pdf', 'https://darpg.gov.in/static/uploads/2025/10/e4360b9fcbc0a1a94649c758541051a0.pdf', 'course-materials/' || c.id || '/CSMOP-2022.pdf',
  'CSMOP 16th Edition: DARPG nodal for Secretariat procedures. Balances speed, quality, transparency. Covers structure of Govt, definitions, office procedures, file management, disposal of cases, eOffice 7.0, delayering, digitization. Essential for Section Officers, Under Secretaries. Includes appendices on Departmental Instructions, record retention, inspection.',
  'en'
FROM public.courses c WHERE c.external_id = 'do_113473107400630272120'
ON CONFLICT DO NOTHING;

INSERT INTO public.course_materials (course_id, title, type, url, storage_path, content_text, language)
SELECT c.id, 'CSMOP - Manual (HWB)', 'pdf', 'https://hwb.gov.in/sites/default/files/2025-06/csmop_0_0.pdf', 'course-materials/' || c.id || '/csmop_hwb.pdf',
  'CSMOP attempts to balance conflicting considerations of speed, quality, transparency and propriety. Procedures for handling receipts, cases, files, and accountability in Central Secretariat.',
  'en'
FROM public.courses c WHERE c.external_id = 'do_113473107400630272120'
ON CONFLICT DO NOTHING;

-- Leadership
INSERT INTO public.course_materials (course_id, title, type, url, storage_path, content_text, language)
SELECT c.id, 'Induction Training Programme - Cutting Edge Government (DoPT)', 'pdf', 'https://documents.doptcirculars.nic.in/D2/D02trn/TOTmanualfinal.compressed.pdf', 'course-materials/' || c.id || '/TOTmanual.pdf',
  'National Training Policy 2012: all civil servants provided training for competencies. Induction Training impacts service delivery and capacity building. Covers leadership, ethics, governance, and behavioural competencies for cutting edge functionaries. Mission Karmayogi and CBC capacity building.',
  'en'
FROM public.courses c WHERE c.external_id = 'do_1136364937253437441916'
ON CONFLICT DO NOTHING;

-- Communication - Noting & Drafting (MCRHRDI, verified PDF)
INSERT INTO public.course_materials (course_id, title, type, url, storage_path, content_text, language)
SELECT c.id, 'Noting and Drafting Skills - MCRHRDI (ISTM)', 'pdf', 'https://mcrhrdi.gov.in/fcg2/studymaterial/week3/Noting%20and%20Drafting.pdf', 'course-materials/' || c.id || '/Noting_and_Drafting_MCRHRDI.pdf',
  'Noting and Drafting Skills: Note means remarks on a case to facilitate disposal. Proper referencing chronologically, forms of communication (Office Memorandum, Circular, Notification). Drafting principles: clarity, conciseness, coherence, referencing, file number, subject. ISTM training material for government officials.',
  'en'
FROM public.courses c WHERE c.external_id = 'do_113923174474121216195'
ON CONFLICT DO NOTHING;

INSERT INTO public.course_materials (course_id, title, type, url, storage_path, content_text, language)
SELECT c.id, 'Office Procedure - Distance Learning Module (DoPT)', 'pdf', 'https://trgdiv.dopt.gov.in/otrainingStatic/UNDPProject/undp_modules/Office%20Proceedure%20DLM.pdf', 'course-materials/' || c.id || '/Office_Procedure_DLM.pdf',
  'DoPT Distance Learning Module on Office Procedure: noting, drafting, decision making, administrative procedures, file management, structured notes, action points.',
  'en'
FROM public.courses c WHERE c.external_id = 'do_113923174474121216195'
ON CONFLICT DO NOTHING;

-- Add generic materials for a few existing courses if missing (helps quiz generation)
INSERT INTO public.course_materials (course_id, title, type, url, content_text, language)
SELECT c.id, 'Study Material: ' || c.title, 'text', c.course_url,
  'Comprehensive material for ' || c.title || ': ' || COALESCE(c.description, 'Government training content') || ' Includes examples and exercises.',
  'en'
FROM public.courses c
WHERE c.source = 'iGOT' AND c.external_id LIKE 'seed-igot-%'
ON CONFLICT DO NOTHING;

-- Verify
SELECT 'courses total: ' || COUNT(*) FROM public.courses;
SELECT external_id, title, course_url FROM public.courses WHERE external_id LIKE 'do_113%';
SELECT 'materials: ' || COUNT(*) FROM public.course_materials;
