/**
 * TypeScript Type Definitions for SkillUp Backend
 * 
 * This file contains all the shared TypeScript interfaces and types
 * used across the backend API Gateway.
 * 
 * Why: Centralizing types ensures consistency across routes, services,
 * and prevents runtime errors from mismatched data structures.
 */

// ============================================
// User & Authentication Types
// ============================================

/**
 * User role enumeration
 * Defines the different access levels in the system
 */
export enum UserRole {
  LEARNER = 'learner',
  MANAGER = 'manager',
  ADMIN = 'admin',
}

/**
 * User profile data from Supabase auth
 */
export interface AuthUser {
  id: string;
  email: string;
  email_confirmed_at?: string;
  created_at: string;
}

/**
 * Extended profile with application-specific data
 */
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  designation: string;
  department: string;
  ministry: string;
  organization_level: string;
  current_assignment?: string;
  education?: string;
  years_experience?: number;
  preferred_language: string;
  voice_navigation_enabled: boolean;
  consent_given: boolean;
  consent_timestamp?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Registration request payload
 */
export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  designation: string;
  department: string;
  ministry?: string;
  organization_level?: string;
}

/**
 * Login request payload
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Auth response with JWT token
 */
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
  profile?: Profile;
}

// ============================================
// Competency & Skill Types
// ============================================

/**
 * Competency domain (4 mandated domains)
 */
export interface CompetencyDomain {
  id: string;
  name: 'Statistical' | 'Technical' | 'Digital Governance' | 'Behavioural';
}

/**
 * Individual competency within a domain
 */
export interface Competency {
  id: string;
  domain_id: string;
  name: string;
  description?: string;
  embedding?: number[];
}

/**
 * User's competency score tracking
 */
export interface UserCompetencyScore {
  id: string;
  user_id: string;
  competency_id: string;
  current_score: number;
  required_score: number;
  gap_score: number;
  updated_at: string;
  competency?: Competency;
}

/**
 * Gap calculation status for UI display
 */
export type GapStatus = 'high' | 'medium' | 'achieved';

/**
 * Skill gap with calculated status
 */
export interface SkillGap {
  competency: Competency;
  current_score: number;
  required_score: number;
  gap_score: number;
  status: GapStatus;
}

// ============================================
// Course & Learning Types
// ============================================

/**
 * Course source enumeration
 */
export enum CourseSource {
  IGOT = 'iGOT',
  NSSTA_TPAC = 'NSSTA_TPAC',
  MOSPI_INTERNAL = 'MoSPI_Internal',
}

/**
 * Course entity
 */
export interface Course {
  id: string;
  source: CourseSource;
  external_id?: string;
  title: string;
  description?: string;
  provider?: string;
  duration_hours: number;
  course_url?: string;
  is_tpac_classroom: boolean;
  tpac_start_date?: string;
  tpac_location?: string;
  target_competencies: string[];
  embedding?: number[];
  created_at: string;
}

/**
 * Course enrollment status
 */
export interface EnrollmentStatus {
  enrolled: boolean;
  completed: boolean;
  progress_percentage?: number;
  started_at?: string;
  completed_at?: string;
}

/**
 * Learning recommendation with priority
 */
export interface LearningRecommendation {
  course: Course;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  matching_gap: string;
}

// ============================================
// Assessment Types
// ============================================

/**
 * Bloom's taxonomy levels for question tagging
 */
export enum BloomLevel {
  REMEMBER = 'remember',
  UNDERSTAND = 'understand',
  APPLY = 'apply',
  ANALYZE = 'analyze',
  EVALUATE = 'evaluate',
  CREATE = 'create',
}

/**
 * Review status for assessment attempts
 */
export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  FLAGGED = 'flagged',
}

/**
 * Assessment question
 */
export interface AssessmentQuestion {
  id: string;
  competency_id: string;
  text: string;
  options: string[];
  correct_answer: number;
  bloom_level: BloomLevel;
  difficulty: number; // IRT b-value
  explanation?: string;
}

/**
 * Assessment attempt with telemetry
 */
export interface AssessmentAttempt {
  id: string;
  user_id: string;
  course_id: string;
  auto_score: number;
  passed: boolean;
  tab_switch_count: number;
  fullscreen_exits: number;
  time_taken_seconds: number;
  telemetry_flags: string[];
  status: ReviewStatus;
  created_at: string;
}

/**
 * Assessment review by admin
 */
export interface AssessmentReview {
  id: string;
  attempt_id: string;
  user_id: string;
  auto_score: number;
  final_verified_score?: number;
  review_status: ReviewStatus;
  verified_by?: string;
  admin_notes?: string;
  updated_at: string;
}

// ============================================
// Certificate Types
// ============================================

/**
 * Certificate entity
 */
export interface Certificate {
  id: string;
  user_id: string;
  course_id: string;
  verification_code: string;
  auto_score: number;
  verified_score: number;
  signed_by_admin: string;
  issue_date: string;
}

// ============================================
// API Response Types
// ============================================

/**
 * Standard API success response
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

/**
 * Standard API error response
 */
export interface ApiError {
  success: false;
  error: string;
  details?: Record<string, string[]>;
  code?: string;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ============================================
// Dashboard Types
// ============================================

/**
 * Employee dashboard summary
 */
export interface EmployeeDashboard {
  user: Profile;
  overall_progress: number;
  competency_scores: UserCompetencyScore[];
  skill_gaps: SkillGap[];
  recommended_courses: LearningRecommendation[];
  learning_metrics: LearningMetrics;
}

/**
 * Learning metrics for dashboard
 */
export interface LearningMetrics {
  total_learning_hours: number;
  completed_courses: number;
  average_quiz_score: number;
  certificates_earned: number;
  current_streak: number;
}

/**
 * Admin dashboard overview
 */
export interface AdminDashboard {
  total_officials: number;
  average_proficiency: number;
  department_matrix: DepartmentCompetencyMatrix[];
  training_effectiveness: number;
  top_skill_gaps: SkillGap[];
  pending_reviews: number;
}

/**
 * Department vs Competency matrix for heatmap
 */
export interface DepartmentCompetencyMatrix {
  department: string;
  competencies: {
    name: string;
    average_score: number;
    official_count: number;
  }[];
}