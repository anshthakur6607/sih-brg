/**
 * Database Type Definitions (Generated from Supabase Schema)
 * 
 * This file defines TypeScript types that mirror the PostgreSQL database schema.
 * These types are used for type-safe database operations with Supabase.
 * 
 * Why: Provides compile-time type checking for database queries and ensures
 * the backend code matches the actual database schema.
 */

// PostgrestTypes removed

// ============================================
// Enums (matching database enums)
// ============================================

export type UserRole = 'learner' | 'manager' | 'admin';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export type CourseSource = 'iGOT' | 'NSSTA_TPAC' | 'MoSPI_Internal';

// ============================================
// Table Row Types
// ============================================

/**
 * Profiles table - stores user profile information
 */
export interface ProfilesRow {
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
 * Competency domains table - 4 mandated domains
 */
export interface CompetencyDomainsRow {
  id: string;
  name: 'Statistical' | 'Technical' | 'Digital Governance' | 'Behavioural';
}

/**
 * Competencies table - individual skills within domains
 */
export interface CompetenciesRow {
  id: string;
  domain_id: string;
  name: string;
  embedding?: number[];
}

/**
 * User competency scores table - tracks user skill levels
 */
export interface UserCompetencyScoresRow {
  id: string;
  user_id: string;
  competency_id: string;
  current_score: number;
  required_score: number;
  gap_score?: number; // Generated column
  updated_at: string;
}

/**
 * Courses table - course catalog from various sources
 */
export interface CoursesRow {
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
  created_at?: string;
}

/**
 * Assessment attempts table - stores exam attempts with telemetry
 */
export interface AssessmentAttemptsRow {
  id: string;
  user_id: string;
  course_id: string;
  auto_score?: number;
  passed: boolean;
  tab_switch_count: number;
  fullscreen_exits: number;
  time_taken_seconds: number;
  telemetry_flags: string[];
  status: ReviewStatus;
  created_at: string;
}

/**
 * Assessment reviews table - admin verification queue
 */
export interface AssessmentReviewsRow {
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

/**
 * Certificates table - issued certificates
 */
export interface CertificatesRow {
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
// Database Type (combines all tables)
// ============================================

/**
 * Complete database schema type for Supabase client
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfilesRow;
        Insert: Omit<ProfilesRow, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ProfilesRow, 'id' | 'created_at'>>;
      };
      competency_domains: {
        Row: CompetencyDomainsRow;
        Insert: Omit<CompetencyDomainsRow, 'id'>;
        Update: Partial<Omit<CompetencyDomainsRow, 'id'>>;
      };
      competencies: {
        Row: CompetenciesRow;
        Insert: Omit<CompetenciesRow, 'id'>;
        Update: Partial<Omit<CompetenciesRow, 'id'>>;
      };
      user_competency_scores: {
        Row: UserCompetencyScoresRow;
        Insert: Omit<UserCompetencyScoresRow, 'id' | 'updated_at'>;
        Update: Partial<Omit<UserCompetencyScoresRow, 'id'>>;
      };
      courses: {
        Row: CoursesRow;
        Insert: Omit<CoursesRow, 'id' | 'created_at'>;
        Update: Partial<Omit<CoursesRow, 'id'>>;
      };
      assessment_attempts: {
        Row: AssessmentAttemptsRow;
        Insert: Omit<AssessmentAttemptsRow, 'id' | 'created_at'>;
        Update: Partial<Omit<AssessmentAttemptsRow, 'id'>>;
      };
      assessment_reviews: {
        Row: AssessmentReviewsRow;
        Insert: Omit<AssessmentReviewsRow, 'id' | 'updated_at'>;
        Update: Partial<Omit<AssessmentReviewsRow, 'id'>>;
      };
      certificates: {
        Row: CertificatesRow;
        Insert: Omit<CertificatesRow, 'id'>;
        Update: Partial<Omit<CertificatesRow, 'id'>>;
      };
    };
    Views: {};
    Functions: {
      // Vector similarity search functions would be defined here
      match_competencies: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
        };
        Returns: CompetenciesRow[];
      };
      match_courses: {
        Args: {
          query_embedding: number[];
          match_threshold: number;
          match_count: number;
        };
        Returns: CoursesRow[];
      };
    };
    Enums: {
      user_role: UserRole;
      review_status: ReviewStatus;
      bloom_level: BloomLevel;
      course_source: CourseSource;
    };
  };
}
