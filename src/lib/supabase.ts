/**
 * Supabase Client Configuration
 * 
 * This module initializes the Supabase client for the backend API.
 * It provides two clients:
 * 1. Service role client - For admin operations bypassing RLS
 * 2. Regular client - For authenticated user operations
 * 
 * Why: Supabase is our primary database with PostgreSQL + pgvector.
 * The service role bypasses Row Level Security for system operations,
 * while the regular client respects RLS policies.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';

// Environment variables (set in .env file)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Validate required environment variables
const missingEnv = !supabaseUrl || !supabaseServiceKey || !supabaseAnonKey;
if (missingEnv) {
  console.warn('Warning: Some Supabase environment variables are missing.');
  console.warn('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY for full functionality.');
}

/**
 * Service Role Client
 * Used for backend operations that need to bypass RLS
 * WARNING: This client has full database access - use carefully
 */
export const supabaseAdmin: any = missingEnv ? new Proxy({}, {
  get() {
    return (..._args: any[]) => {
      return Promise.reject(new Error('Supabase not configured: missing SUPABASE_URL or keys'));
    };
  }
}) : createClient(
  supabaseUrl as string,
  supabaseServiceKey as string,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Regular Supabase Client
 * Used for authenticated user operations
 * Respects Row Level Security policies
 */
export const createSupabaseClient = (jwt?: string): any => {
  if (missingEnv) {
    return new Proxy({}, {
      get() {
        return (..._args: any[]) => Promise.reject(new Error('Supabase not configured: missing SUPABASE_URL or keys'));
      }
    });
  }
  return createClient(supabaseUrl as string, supabaseAnonKey as string, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    },
  });
};

// Re-export types for convenience
export type { Database } from '../types/database.js';