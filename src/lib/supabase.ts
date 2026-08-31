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
if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('Missing required Supabase environment variables:');
  console.error('- SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  console.error('- SUPABASE_ANON_KEY');
  process.exit(1);
}

/**
 * Service Role Client
 * Used for backend operations that need to bypass RLS
 * WARNING: This client has full database access - use carefully
 */
export const supabaseAdmin: any = createClient(
  supabaseUrl,
  supabaseServiceKey,
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
  return createClient(supabaseUrl, supabaseAnonKey, {
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