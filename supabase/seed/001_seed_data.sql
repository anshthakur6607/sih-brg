-- SkillUp Database Seed Data
-- Version: 001 - Idempotent (LIMIT 1 + ON CONFLICT)
-- Description: Seeds initial competency domains, competencies, and sample courses
-- Run AFTER migrations/001_initial_schema.sql and 002_migration_v2_spec.sql
-- Re-runnable: uses ON CONFLICT DO NOTHING and LIMIT 1 for subqueries

-- ============================================
-- Seed Data: Competency Domains (4 Mandated)
-- ============================================
INSERT INTO competency_domains (name) VALUES
  ('Statistical'),
  ('Technical'),
  ('Digital Governance'),
  ('Behavioural')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Seed Data: Competencies (idempotent via unique index on domain_id,name)
-- ============================================
INSERT INTO competencies (domain_id, name) VALUES
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'Survey Sampling'),
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'National Accounts'),
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'SDG Indicators'),
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'Data Quality'),
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'Statistical Analysis'),
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'Census Operations'),
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'Sample Design'),
((SELECT id FROM competency_domains WHERE name = 'Statistical' LIMIT 1), 'Data Collection'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'Python'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'R'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'SQL'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'GIS'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'AI/ML'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'Open Data'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'Data Visualization'),
((SELECT id FROM competency_domains WHERE name = 'Technical' LIMIT 1), 'Database Management'),
((SELECT id FROM competency_domains WHERE name = 'Digital Governance' LIMIT 1), 'Cybersecurity'),
((SELECT id FROM competency_domains WHERE name = 'Digital Governance' LIMIT 1), 'Data Privacy'),
((SELECT id FROM competency_domains WHERE name = 'Digital Governance' LIMIT 1), 'DPI'),
((SELECT id FROM competency_domains WHERE name = 'Digital Governance' LIMIT 1), 'Govt Cloud'),
((SELECT id FROM competency_domains WHERE name = 'Digital Governance' LIMIT 1), 'Digital Infrastructure'),
((SELECT id FROM competency_domains WHERE name = 'Digital Governance' LIMIT 1), 'e-Governance'),
((SELECT id FROM competency_domains WHERE name = 'Digital Governance' LIMIT 1), 'ICT'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Leadership'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Communication'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Ethics'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Change Management'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Team Management'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Problem Solving'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Time Management'),
((SELECT id FROM competency_domains WHERE name = 'Behavioural' LIMIT 1), 'Decision Making')
ON CONFLICT (domain_id, name) DO NOTHING;

-- ============================================
-- Seed Data: iGOT Online Courses
-- ============================================
INSERT INTO courses (title, description, provider, duration_hours, source, target_competencies) VALUES
('Introduction to Survey Sampling',
 'Learn the fundamentals of survey sampling methodology including simple random sampling, stratified sampling, and cluster sampling.',
 'LBSNAA', 8, 'iGOT',
 '["Survey Sampling", "Sample Design", "Data Collection"]'),
('Data Quality Assurance',
 'Master techniques for ensuring data quality in government surveys including validation, imputation, and quality control.',
 'NSSTA', 6, 'iGOT',
 '["Data Quality", "Statistical Analysis"]'),
('National Accounts Methodology',
 'Understanding System of National Accounts (SNA) frameworks and GDP computation methods.',
 'CSO', 10, 'iGOT',
 '["National Accounts", "Statistical Analysis"]'),
('SDG Indicators Training',
 'Measuring and reporting on Sustainable Development Goals (SDGs) with focus on Indian context.',
 'MoSPI', 8, 'iGOT',
 '["SDG Indicators", "Data Quality", "Data Collection"]'),
('Census Operations Overview',
 'Comprehensive training on census methodology and operations in India.',
 'MoSPI', 12, 'iGOT',
 '["Census Operations", "Survey Sampling", "Data Collection"]'),
('Python for Data Analysis',
 'Introduction to Python programming for statistical analysis and data manipulation using pandas and numpy.',
 'DIID', 12, 'iGOT',
 '["Python", "Data Visualization", "Data Analysis"]'),
('R for Statistics',
 'Statistical computing using R programming language for government data analysis.',
 'NSSTA', 10, 'iGOT',
 '["R", "Statistical Analysis", "Data Visualization"]'),
('SQL for Government Data',
 'Database querying and management using SQL for official statistics.',
 'DIID', 8, 'iGOT',
 '["SQL", "Database Management"]'),
('GIS Applications in Governance',
 'Geographic Information Systems for spatial analysis and mapping in government.',
 'DIID', 8, 'iGOT',
 '["GIS", "Data Visualization"]'),
('Introduction to AI/ML',
 'Overview of artificial intelligence and machine learning for government applications.',
 'DIID', 6, 'iGOT',
 '["AI/ML", "Data Analysis"]'),
('Data Privacy and Security',
 'Protecting sensitive government data and understanding data protection regulations.',
 'NIC', 4, 'iGOT',
 '["Data Privacy", "Cybersecurity"]'),
('Cybersecurity Fundamentals',
 'Essential cybersecurity practices for government officials.',
 'NIC', 6, 'iGOT',
 '["Cybersecurity", "Data Privacy"]'),
('Digital India Initiative',
 'Overview of Digital India program and its implementation.',
 'MeitY', 4, 'iGOT',
 '["DPI", "e-Governance", "Digital Infrastructure"]'),
('GovCloud Essentials',
 'Understanding government cloud computing infrastructure and services.',
 'NIC', 4, 'iGOT',
 '["Govt Cloud", "Digital Infrastructure"]'),
('Leadership Skills for Managers',
 'Developing leadership capabilities for senior government officials.',
 'LBSNAA', 6, 'iGOT',
 '["Leadership", "Team Management", "Decision Making"]'),
('Effective Communication',
 'Enhancing communication skills for government professionals.',
 'LBSNAA', 4, 'iGOT',
 '["Communication", "Problem Solving"]'),
('Ethics in Public Service',
 'Understanding ethical principles and code of conduct for civil servants.',
 'LBSNAA', 4, 'iGOT',
 '["Ethics"]'),
('Change Management',
 'Managing organizational change and transformation in government.',
 'LBSNAA', 4, 'iGOT',
 '["Change Management", "Leadership"]'),
('Project Management',
 'Essential project management skills for government projects.',
 'DIID', 6, 'iGOT',
 '["Time Management", "Problem Solving", "Decision Making"]')
ON CONFLICT (title, provider) DO NOTHING;

-- ============================================
-- Seed Data: TPAC Classroom Sessions (NSSTA)
-- ============================================
INSERT INTO courses (title, description, provider, duration_hours, source, is_tpac_classroom, tpac_start_date, tpac_location, target_competencies) VALUES
('Advanced Statistical Methods',
 'In-depth training on advanced statistical techniques including multivariate analysis, time series, and econometrics.',
 'NSSTA', 40, 'NSSTA_TPAC', true, '2024-03-15', 'NSSTA, Greater Noida',
 '["Statistical Analysis", "Data Analysis", "R"]'),
('Data Science Workshop',
 'Hands-on workshop on data science applications using Python, machine learning, and big data technologies.',
 'NSSTA', 24, 'NSSTA_TPAC', true, '2024-04-20', 'NSSTA, Greater Noida',
 '["Python", "AI/ML", "Data Visualization"]'),
('Geographic Information Systems Advanced',
 'Advanced GIS training for spatial analysis, remote sensing, and mapping applications.',
 'NSSTA', 32, 'NSSTA_TPAC', true, '2024-05-10', 'NSSTA, Greater Noida',
 '["GIS", "Data Visualization"]'),
('Survey Design and Analysis',
 'Comprehensive training on designing and analyzing household and establishment surveys.',
 'NSSTA', 36, 'NSSTA_TPAC', true, '2024-06-15', 'NSSTA, Greater Noida',
 '["Survey Sampling", "Sample Design", "Statistical Analysis"]'),
('National Accounts Advanced',
 'Advanced topics in national accounts including satellite accounts, informal sector estimation.',
 'NSSTA', 28, 'NSSTA_TPAC', true, '2024-07-20', 'NSSTA, Greater Noida',
 '["National Accounts", "Statistical Analysis"]'),
('Data Quality Management',
 'Training on data quality frameworks, validation techniques, and quality assurance.',
 'NSSTA', 20, 'NSSTA_TPAC', true, '2024-08-10', 'NSSTA, Greater Noida',
 '["Data Quality", "Database Management"]')
ON CONFLICT (title, provider) DO NOTHING;

-- ============================================
-- Seed Data: Sample Assessment Questions
-- ============================================
INSERT INTO questions (competency_id, text, options, correct_answer, bloom_level, difficulty_beta, explanation) VALUES
((SELECT id FROM competencies WHERE name = 'Survey Sampling' LIMIT 1),
 'What is the main advantage of stratified random sampling over simple random sampling?',
 '["It is cheaper to implement", "It ensures representation of all subgroups", "It requires smaller sample sizes", "It eliminates sampling bias completely"]',
 1, 'understand', 0.5,
 'Stratified sampling ensures that all subgroups (strata) of the population are represented in the sample, which improves representativeness.'),
((SELECT id FROM competencies WHERE name = 'Survey Sampling' LIMIT 1),
 'What is the purpose of a sampling frame?',
 '["To determine sample size", "To list all units in the target population", "To select random samples", "To calculate survey weights"]',
 1, 'remember', 0.0,
 'A sampling frame is a complete list of all units in the target population from which a sample is drawn.'),
((SELECT id FROM competencies WHERE name = 'Python' LIMIT 1),
 'Which Python library is primarily used for data manipulation?',
 '["NumPy", "Pandas", "Matplotlib", "Scikit-learn"]',
 1, 'remember', -0.5,
 'Pandas is the primary library for data manipulation and analysis in Python.'),
((SELECT id FROM competencies WHERE name = 'Python' LIMIT 1),
 'How do you create a DataFrame in Pandas?',
 '["DataFrame()", "createDataFrame()", "new DataFrame()", "df.create()"]',
 0, 'remember', 0.0,
 'DataFrame() is the constructor method used to create a DataFrame in Pandas.'),
((SELECT id FROM competencies WHERE name = 'SQL' LIMIT 1),
 'Which SQL clause is used to filter grouped results?',
 '["WHERE", "GROUP BY", "HAVING", "FILTER"]',
 2, 'understand', 0.5,
 'HAVING is used to filter results after GROUP BY aggregation, unlike WHERE which filters before.'),
((SELECT id FROM competencies WHERE name = 'Data Privacy' LIMIT 1),
 'What does GDPR stand for?',
 '["General Data Protection Regulation", "Government Data Privacy Rules", "Global Data Privacy Requirements", "General Digital Privacy Regulation"]',
 0, 'remember', 0.0,
 'GDPR stands for General Data Protection Regulation, the EU data privacy law.'),
((SELECT id FROM competencies WHERE name = 'Leadership' LIMIT 1),
 'Which leadership style involves making decisions without team input?',
 '["Democratic", "Autocratic", "Laissez-faire", "Transformational"]',
 1, 'understand', -0.5,
 'Autocratic leadership involves the leader making decisions independently without team consultation.'),
((SELECT id FROM competencies WHERE name = 'Cybersecurity' LIMIT 1),
 'What is phishing?',
 '["A type of firewall", "A social engineering attack using deceptive emails", "A malware detection tool", "A network protocol"]',
 1, 'remember', -0.5,
 'Phishing is a cyber attack that uses disguised emails to trick recipients into revealing sensitive information.')
ON CONFLICT (competency_id, text) DO NOTHING;

-- ============================================
-- Verify Seed Data
-- ============================================
SELECT 'Competency Domains: ' || COUNT(*) || ' rows' AS status FROM competency_domains;
SELECT 'Competencies: ' || COUNT(*) || ' rows' AS status FROM competencies;
SELECT 'Courses: ' || COUNT(*) || ' rows' AS status FROM courses;
SELECT 'Assessment Questions: ' || COUNT(*) || ' rows' AS status FROM questions;
