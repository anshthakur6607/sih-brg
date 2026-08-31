-- ============================================
-- Fix handle_new_user trigger
-- ============================================
-- The original trigger may fail on the remote Supabase database
-- because it inserts with NOT NULL columns that could be empty.
-- This migration replaces the trigger with a more resilient version
-- that doesn't break user creation if the profile insert fails.
-- ============================================

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Create a more resilient handle_new_user function
-- that won't break user creation if profile insert fails
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Try to insert profile, but don't fail the transaction if it doesn't work
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, designation, department, ministry)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      COALESCE(NEW.raw_user_meta_data->>'designation', 'Employee'),
      COALESCE(NEW.raw_user_meta_data->>'department', 'General'),
      COALESCE(NEW.raw_user_meta_data->>'ministry', 'MoSPI')
    )
    ON CONFLICT (id) DO NOTHING; -- Don't fail if profile already exists
  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the user creation
    RAISE WARNING 'handle_new_user: Failed to create profile for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Add comment for clarity
COMMENT ON FUNCTION handle_new_user() IS 'Creates a profile when a new auth user is created. Failures are logged but do not block user creation.';
