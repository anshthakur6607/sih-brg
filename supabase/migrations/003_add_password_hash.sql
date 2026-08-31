-- Add password_hash column to profiles table for custom auth
-- This bypasses Supabase Auth triggers entirely

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Update the handle_new_user trigger to not break user creation
-- (for any users still created via Supabase Auth)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
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
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Failed to create profile for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
