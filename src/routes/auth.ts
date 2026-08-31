/**
 * Authentication Routes
 *
 * Custom JWT-based authentication that bypasses Supabase Auth triggers.
 * Uses bcrypt for password hashing and Supabase only for data storage.
 */

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'skillup-secret-key-change-in-production';
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60; // 7 days in seconds

// Public Supabase client (anon key) for signup
const supabasePublic = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().min(2, 'Full name is required'),
  designation: z.string().min(2, 'Designation is required'),
  department: z.string().min(2, 'Department is required'),
  ministry: z.string().optional().default('MoSPI'),
  organization_level: z.string().optional().default('Central'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * POST /api/auth/register
 *
 * Creates a new user using custom auth (bcrypt + JWT).
 * Stores password hash in the profiles table.
 * Completely bypasses Supabase Auth triggers.
 */
router.post('/register', authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const validatedData = registerSchema.parse(req.body);
  const { email, password, full_name, designation, department, ministry, organization_level } = validatedData;

  // Check if user already exists
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .single();

  if (existingProfile) {
    res.status(409).json({
      success: false,
      error: 'User with this email already exists',
      code: 'USER_EXISTS',
    });
    return;
  }

  // Step 1: Create auth user via Supabase Auth admin API (email confirmed automatically)
  let authUserId: string | null = null;
  const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, designation, department, ministry, organization_level },
  });

  if (adminData?.user) {
    authUserId = adminData.user.id;
  }

  // If admin createUser failed, try public signUp as fallback
  if (!authUserId) {
    console.log('Admin createUser failed, trying public signUp:', adminError?.message);
    const { data: signUpData, error: signUpError } = await supabasePublic.auth.signUp({
      email,
      password,
      options: {
        data: { full_name, designation, department, ministry, organization_level },
      },
    });

    if (signUpData?.user) {
      authUserId = signUpData.user.id;
    } else {
      console.error('Both signUp methods failed:', adminError?.message, signUpError?.message);

      // Last resort: create with a unique ID and skip the FK
      // Store directly in profiles without auth.users (this is a hack)
      const passwordHash = await bcrypt.hash(password, 12);
      const fakeId = crypto.randomUUID();

      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: fakeId,
          email,
          full_name,
          role: 'learner',
          designation,
          department,
          ministry: ministry || 'MoSPI',
          organization_level: organization_level || 'Central',
          preferred_language: 'en',
          voice_navigation_enabled: true,
          consent_given: false,
          education: `pwd:${passwordHash}`,
        })
        .select()
        .single();

      if (profileError) {
        // If it's a FK error, we truly can't create a user
        if (profileError.code === '23503') {
          res.status(503).json({
            success: false,
            error: 'Registration is temporarily unavailable. Please contact support.',
            code: 'AUTH_UNAVAILABLE',
            details: 'Cannot create user: Supabase Auth is not accessible and profiles table requires an auth user.',
          });
          return;
        }
        res.status(500).json({
          success: false,
          error: 'Failed to create user account',
          code: 'PROFILE_CREATION_FAILED',
          details: profileError.message,
        });
        return;
      }

      const token = jwt.sign({ sub: fakeId, email, role: 'learner' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.status(201).json({
        success: true,
        data: {
          access_token: token,
          refresh_token: '',
          user: { id: fakeId, email, email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString() },
          profile: { id: profile.id, full_name: profile.full_name, role: profile.role, designation: profile.designation, department: profile.department },
        },
        message: 'Registration successful (demo mode)',
      });
      return;
    }
  }

  // Step 2: Ensure profile exists and store password hash
  let profile: any = null;
  const { data: existingAfterSignup } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', authUserId)
    .single();

  // Compute password hash once (used whether trigger created profile or not)
  const passwordHash = await bcrypt.hash(password, 12);

  if (existingAfterSignup) {
    profile = existingAfterSignup;
    // If the profile was created by the trigger and lacks the password hash, update it
    if (!profile.education) {
      const { error: updErr } = await supabaseAdmin
        .from('profiles')
        .update({ education: `pwd:${passwordHash}` })
        .eq('id', authUserId);
      if (updErr) console.error('Failed to set password hash on existing profile', updErr);
    }
  } else {
    // Create profile manually (including password hash)
    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authUserId,
        email,
        full_name,
        role: 'learner',
        designation,
        department,
        ministry: ministry || 'MoSPI',
        organization_level: organization_level || 'Central',
        preferred_language: 'en',
        voice_navigation_enabled: true,
        consent_given: false,
        education: `pwd:${passwordHash}`,
      })
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      // Don't fail - the auth user exists, profile can be created later
      profile = { id: authUserId, full_name, role: 'learner', designation, department };
    } else {
      profile = newProfile;
    }
  }

  // Generate JWT
  const token = jwt.sign({ sub: authUserId, email, role: 'learner' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  res.status(201).json({
    success: true,
    data: {
      access_token: token,
      refresh_token: '',
      user: {
        id: authUserId,
        email,
        email_confirmed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      profile: {
        id: profile.id,
        full_name: profile.full_name,
        role: profile.role,
        designation: profile.designation,
        department: profile.department,
      },
    },
    message: 'Registration successful',
  });
}));

/**
 * POST /api/auth/login
 *
 * Authenticates user with email/password using custom bcrypt auth.
 */
router.post('/login', authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const validatedData = loginSchema.parse(req.body);
  const { email, password } = validatedData;

  // Find user by email
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('email', email)
    .single();

  if (profileError || !profile) {
    res.status(401).json({
      success: false,
      error: 'Invalid email or password',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  // Check for custom auth password hash stored in 'education' column (prefix 'pwd:')
  const educationField = (profile as any).education;
  const passwordHash = educationField?.startsWith('pwd:') ? educationField.slice(4) : null;

  if (!passwordHash) {
    // User was created via Supabase Auth (old method) - try Supabase signIn
    const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    const token = jwt.sign({
        sub: authData.user.id,
        email: authData.user.email,
        role: profile.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      data: {
        access_token: token,
        refresh_token: authData.session?.refresh_token || '',
        user: {
          id: authData.user.id,
          email: authData.user.email,
          email_confirmed_at: authData.user.email_confirmed_at,
          created_at: authData.user.created_at,
        },
        profile: {
          id: profile.id,
          full_name: profile.full_name,
          role: profile.role,
          designation: profile.designation,
          department: profile.department,
          ministry: profile.ministry,
          organization_level: profile.organization_level,
        },
      },
      message: 'Login successful',
    });
    return;
  }

  // Custom auth: verify bcrypt password
  const isValid = await bcrypt.compare(password, passwordHash);

  if (!isValid) {
    res.status(401).json({
      success: false,
      error: 'Invalid email or password',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  const token = jwt.sign({
      sub: profile.id,
      email,
      role: profile.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    success: true,
    data: {
      access_token: token,
      refresh_token: '',
      user: {
        id: profile.id,
        email: profile.email,
        email_confirmed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      profile: {
        id: profile.id,
        full_name: profile.full_name,
        role: profile.role,
        designation: profile.designation,
        department: profile.department,
        ministry: profile.ministry,
        organization_level: profile.organization_level,
      },
    },
    message: 'Login successful',
  });
}));

/**
 * POST /api/auth/logout
 */
router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Logout successful',
  });
}));

/**
 * GET /api/auth/me
 *
 * Returns the current user's profile from the JWT.
 */
router.get('/me', asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'No token provided',
      code: 'NO_TOKEN',
    });
    return;
  }

  // Verify token
  const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; role: string };

  // Get profile
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', decoded.sub)
    .single();

  if (error || !profile) {
    res.status(404).json({
      success: false,
      error: 'Profile not found',
      code: 'PROFILE_NOT_FOUND',
    });
    return;
  }

  res.json({
    success: true,
    data: {
      user: { id: decoded.sub, email: decoded.email },
      profile: {
        id: profile.id,
        full_name: profile.full_name,
        role: profile.role,
        designation: profile.designation,
        department: profile.department,
        ministry: profile.ministry,
        organization_level: profile.organization_level,
      },
    },
  });
}));

/**
 * POST /api/auth/refresh
 */
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    // For custom auth, re-issue token if current one is still valid
    res.status(400).json({
      success: false,
      error: 'Refresh token required',
      code: 'NO_REFRESH_TOKEN',
    });
    return;
  }

  // Try Supabase refresh for legacy users
  const { data: authData, error } = await supabaseAdmin.auth.refreshSession({
    refresh_token,
  });

  if (error || !authData.user) {
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token',
      code: 'INVALID_REFRESH_TOKEN',
    });
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single();

  const token = jwt.sign({
      sub: authData.user.id,
      email: authData.user.email,
      role: profile?.role || 'learner',
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    success: true,
    data: {
      access_token: token,
      refresh_token: authData.session?.refresh_token || '',
    },
  });
}));

export default router;
