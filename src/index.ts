/**
 * SkillUp Backend API Gateway
 * 
 * This is the main entry point for the Express.js API Gateway.
 * It handles:
 * - HTTP server setup with security middleware
 * - API route registration
 * - Error handling
 * - Health check endpoints
 * 
 * Why: Central API gateway that routes requests to internal services,
 * applies security headers, validates input, and handles rate limiting.
 */

import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';

// Import routes
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import courseRoutes from './routes/courses.js';
import assessmentRoutes from './routes/assessments.js';
import competencyRoutes from './routes/competencies.js';
import certificateRoutes from './routes/certificates.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import igotRoutes from './routes/igot.js';
import surveysRoutes from './routes/surveys.js';
import recommendationsRoutes from './routes/recommendations.js';
import enrollmentsRoutes from './routes/enrollments.js';
import liveQuizRoutes from './routes/liveQuiz.js';
import integrationsRoutes from './routes/integrations.js';
import materialsRoutes from './routes/materials.js';
import gamificationRoutes from './routes/gamification.js';
import bannerRoutes from './routes/banners.js';
import remindersRoutes from './routes/reminders.js';
import dailySuggestionsRoutes from './routes/dailySuggestions.js';

// Import middleware
import { verifyToken } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/logger.js';
import { telemetryLogHandler } from './middleware/telemetryLogger.js';

// Initialize Express app
const app: Express = express();
const PORT = process.env.PORT || 3001;

// Security middleware - Helmet
// Why: Sets various HTTP headers for security (XSS protection, HSTS, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "http://localhost:3001", "https://*.supabase.co", "wss://*.supabase.co", "https://*.googleapis.com", "http://localhost:8001", "ws://localhost:8001", "wss://localhost:8001"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
// Why: Allow frontend to communicate with backend
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing middleware
// Why: Parse JSON request bodies with size limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
// Why: Log requests for debugging and monitoring
app.use(morgan('combined'));
app.use(requestLogger);

// Rate limiting middleware
// Why: Prevent abuse by limiting requests per IP
app.use('/api/', rateLimiter);

// Health check endpoint (no auth required)
// Why: Kubernetes/load balancer health checks
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'skillup-backend',
    version: '1.0.0',
  });
});

// API version endpoint
app.get('/api', (req: Request, res: Response) => {
  res.json({
    message: 'SkillUp API Gateway',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      profile: '/api/profile',
      courses: '/api/courses',
      assessments: '/api/assessments',
      competencies: '/api/competencies',
      certificates: '/api/certificates',
      admin: '/api/admin',
    },
  });
});

// Telemetry (no auth for beacon, but verify assessment_id ownership inside handler)
app.post('/api/telemetry/log', telemetryLogHandler);

// Public: job roles for survey (no auth - survey dropdown must work even before login edge cases)
app.get('/api/surveys/job-roles', async (req: Request, res: Response) => {
  try {
    const { supabaseAdmin } = await import('./lib/supabase.js');
    const { data, error } = await supabaseAdmin.from('job_roles').select('*').order('department', { ascending: true });
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data: data || [] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Protected API routes (require authentication)
app.use('/api/auth', authRoutes);
app.use('/api/profile', verifyToken, profileRoutes);
app.use('/api/courses', verifyToken, courseRoutes);
app.use('/api/assessments', verifyToken, assessmentRoutes);
app.use('/api/competencies', verifyToken, competencyRoutes);
app.use('/api/certificates', verifyToken, certificateRoutes);
app.use('/api/admin', verifyToken, adminRoutes);
app.use('/api/ai', verifyToken, aiRoutes);
app.use('/api/igot', verifyToken, igotRoutes);
app.use('/api/surveys', verifyToken, surveysRoutes);
app.use('/api/recommendations', verifyToken, recommendationsRoutes);
app.use('/api/enrollments', verifyToken, enrollmentsRoutes);
app.use('/api/ai/live-quiz', verifyToken, liveQuizRoutes);
app.use('/api/materials', verifyToken, materialsRoutes);
app.use('/api/gamification', verifyToken, gamificationRoutes);
app.use('/api/banners', verifyToken, bannerRoutes);
app.use('/api/reminders', verifyToken, remindersRoutes);
app.use('/api/daily-suggestions', verifyToken, dailySuggestionsRoutes);

// Public integration endpoints (webhooks, external APIs)
app.use('/api/integrations', integrationsRoutes);

// Live Tutor session persistence (requires auth)
app.post('/api/ai/live-tutor/session', verifyToken, async (req, res) => {
  const { course_id, module_id, last_timestamp, conversation_history, summary_state } = req.body;
  const userId = (req as any).user.id;
  const { supabaseAdmin } = await import('./lib/supabase.js');
  const { data, error } = await supabaseAdmin.from('tutor_sessions').upsert({
    user_id: userId,
    course_id,
    module_id,
    last_timestamp,
    conversation_history,
    summary_state,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,course_id,module_id' }).select().single();
  if (error) { res.status(500).json({ success:false, error: error.message }); return; }
  res.json({ success:true, data });
});

// 404 handler for unmatched routes
// Why: Handle invalid API endpoints gracefully
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Global error handler
// Why: Catch and format all unhandled errors
app.use(errorHandler);

// Start HTTP + WebSocket server
// Why: Begin listening for incoming HTTP requests and WS upgrades
const httpServer = createServer(app);

// WebSocket proxy (mounted at /ws/live-tutor) — bridges to AI service while satisfying browser CSP
import { attachWebSocketProxy } from './wsProxy.js';
attachWebSocketProxy(httpServer);

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   SkillUp Backend API Gateway                             ║
║   Running on http://localhost:${PORT}                        ║
║                                                           ║
║   Endpoints:                                              ║
║   - GET  /health        - Health check                    ║
║   - GET  /api           - API information                 ║
║   - POST /api/auth/*    - Authentication routes           ║
║   - GET  /api/profile/* - User profile routes             ║
║   - GET  /api/courses/* - Course catalog routes           ║
║   - WS   /ws/live-tutor - WebSocket proxy to AI service   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;