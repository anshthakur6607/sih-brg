-- SkillUp Database Test Cases
-- Version: 001
-- Description: Test cases to verify database setup and functionality

-- ============================================
-- Test 1: Verify Extensions
-- ============================================
SELECT 
  'Test 1: Extensions' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM pg_extension WHERE extname IN ('uuid-ossp', 'vector')) = 2 
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Test 2: Verify Tables Exist
-- ============================================
SELECT 
  'Test 2: Tables Exist' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM information_schema.tables 
       WHERE table_schema = 'public' 
       AND table_name IN (
         'profiles', 'competency_domains', 'competencies', 
         'user_competency_scores', 'courses', 'assessment_attempts',
         'assessment_reviews', 'certificates', 'assessment_questions'
       )) = 9
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Test 3: Verify Enums
-- ============================================
SELECT 
  'Test 3: Enums Created' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM pg_type WHERE typname IN ('user_role', 'review_status', 'bloom_level', 'course_source')) = 4
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Test 4: Verify Seed Data - Domains
-- ============================================
SELECT 
  'Test 4: Competency Domains Seeded' AS test_name,
  CASE 
    WHEN (SELECT COUNT(*) FROM competency_domains) >= 4 THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT COUNT(*) FROM competency_domains) AS actual_count;

-- ============================================
-- Test 5: Verify Seed Data - Competencies
-- ============================================
SELECT 
  'Test 5: Competencies Seeded' AS test_name,
  CASE 
    WHEN (SELECT COUNT(*) FROM competencies) >= 20 THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT COUNT(*) FROM competencies) AS actual_count;

-- ============================================
-- Test 6: Verify Seed Data - Courses
-- ============================================
SELECT 
  'Test 6: Courses Seeded' AS test_name,
  CASE 
    WHEN (SELECT COUNT(*) FROM courses) >= 10 THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT COUNT(*) FROM courses) AS actual_count;

-- ============================================
-- Test 7: Verify RLS Policies
-- ============================================
SELECT 
  'Test 7: RLS Enabled' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') >= 10
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') AS policy_count;

-- ============================================
-- Test 8: Verify Indexes
-- ============================================
SELECT 
  'Test 8: Indexes Created' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%') >= 8
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Test 9: Verify Functions
-- ============================================
SELECT 
  'Test 9: Functions Created' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM pg_functions WHERE proname IN ('increment_competency_score', 'handle_new_user')) = 2
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Test 10: Verify Triggers
-- ============================================
SELECT 
  'Test 10: Triggers Created' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM pg_triggers WHERE tgname = 'on_auth_user_created') = 1
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Test 11: Test Competency Domain Distribution
-- ============================================
SELECT 
  'Test 11: Domain Distribution' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(DISTINCT domain_id) FROM competencies) = 4
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT COUNT(DISTINCT domain_id) FROM competencies) AS domain_count;

-- ============================================
-- Test 12: Test Course Sources
-- ============================================
SELECT 
  'Test 12: Course Sources' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(DISTINCT source) FROM courses) >= 2
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT array_agg(DISTINCT source) FROM courses) AS sources;

-- ============================================
-- Test 13: Test TPAC Courses
-- ============================================
SELECT 
  'Test 13: TPAC Classroom Courses' AS test_name,
  CASE 
    WHEN (SELECT COUNT(*) FROM courses WHERE is_tpac_classroom = true) >= 3 THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT COUNT(*) FROM courses WHERE is_tpac_classroom = true) AS tpac_count;

-- ============================================
-- Test 14: Test Assessment Questions
-- ============================================
SELECT 
  'Test 14: Assessment Questions' AS test_name,
  CASE 
    WHEN (SELECT COUNT(*) FROM assessment_questions) >= 5 THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result,
  (SELECT COUNT(*) FROM assessment_questions) AS question_count;

-- ============================================
-- Test 15: Verify Not Null Constraints
-- ============================================
SELECT 
  'Test 15: Not Null Constraints' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM information_schema.columns 
       WHERE table_name = 'profiles' 
       AND column_name IN ('id', 'email', 'full_name', 'designation', 'department')
       AND is_nullable = 'NO') = 5
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Test 16: Verify Unique Constraints
-- ============================================
SELECT 
  'Test 16: Unique Constraints' AS test_name,
  CASE 
    WHEN 
      (SELECT COUNT(*) FROM information_schema.table_constraints 
       WHERE constraint_type = 'UNIQUE' 
       AND table_name IN ('profiles', 'certificates', 'courses')) >= 3
    THEN 'PASS' 
    ELSE 'FAIL' 
  END AS result;

-- ============================================
-- Summary Test Results
-- ============================================
SELECT '=== Test Summary ===' AS info;
SELECT 
  COUNT(CASE WHEN result = 'PASS' THEN 1 END) AS passed,
  COUNT(CASE WHEN result = 'FAIL' THEN 1 END) AS failed,
  COUNT(*) AS total
FROM (
  SELECT 'Test 1: Extensions' AS test_name,
    CASE WHEN (SELECT COUNT(*) FROM pg_extension WHERE extname IN ('uuid-ossp', 'vector')) = 2 THEN 'PASS' ELSE 'FAIL' END AS result
  UNION ALL
  SELECT 'Test 2: Tables Exist',
    CASE WHEN (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('profiles', 'competency_domains', 'competencies', 'user_competency_scores', 'courses', 'assessment_attempts', 'assessment_reviews', 'certificates', 'assessment_questions')) = 9 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 3: Enums Created',
    CASE WHEN (SELECT COUNT(*) FROM pg_type WHERE typname IN ('user_role', 'review_status', 'bloom_level', 'course_source')) = 4 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 4: Domains Seeded',
    CASE WHEN (SELECT COUNT(*) FROM competency_domains) >= 4 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 5: Competencies Seeded',
    CASE WHEN (SELECT COUNT(*) FROM competencies) >= 20 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 6: Courses Seeded',
    CASE WHEN (SELECT COUNT(*) FROM courses) >= 10 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 7: RLS Enabled',
    CASE WHEN (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') >= 10 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 8: Indexes Created',
    CASE WHEN (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%') >= 8 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 9: Functions Created',
    CASE WHEN (SELECT COUNT(*) FROM pg_functions WHERE proname IN ('increment_competency_score', 'handle_new_user')) = 2 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 'Test 10: Triggers Created',
    CASE WHEN (SELECT COUNT(*) FROM pg_triggers WHERE tgname = 'on_auth_user_created') = 1 THEN 'PASS' ELSE 'FAIL' END
) AS test_results;

-- ============================================
-- Sample Queries for Verification
-- ============================================
-- List all competency domains with counts
SELECT d.name AS domain, COUNT(c.id) AS competency_count
FROM competency_domains d
LEFT JOIN competencies c ON c.domain_id = d.id
GROUP BY d.name
ORDER BY d.name;

-- List course counts by source
SELECT source, COUNT(*) AS course_count
FROM courses
GROUP BY source;

-- List TPAC upcoming sessions
SELECT title, tpac_start_date, tpac_location
FROM courses
WHERE is_tpac_classroom = true AND tpac_start_date >= CURRENT_DATE
ORDER BY tpac_start_date;