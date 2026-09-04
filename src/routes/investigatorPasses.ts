/**
 * Investigator Identity Passes — QR-enabled, skill-tied, tamper-proof
 * For PDF pointer: QR-Enabled Badges & Verified Certificates (field investigators)
 * Why: NSS/PLFS/ASI enumerators need QR identity to prove legitimacy to respondents; tied to verified skills
 */

import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../lib/supabase.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { requireAdmin, verifyToken } from '../middleware/auth.js';

const router = Router();

function genPassCode(): string {
  const d = new Date();
  const ds = d.getFullYear().toString() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
  return `IP-${ds}-${uuidv4().replace(/-/g,'').slice(0,8).toUpperCase()}`;
}

// GET /api/investigator-passes — own passes (learner)
router.get('/', verifyToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabaseAdmin.from('investigator_passes').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) { res.status(500).json({ success:false, error:error.message }); return; }
  // enrich with QR payload URL
  const passes = (data||[]).map(p=>({
    ...p,
    verify_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/pass/${p.verification_code}`,
    qr_api_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/pass/${p.verification_code}`)}`
  }));
  res.json({ success:true, data: passes });
}));

// GET /api/investigator-passes/all — admin list
router.get('/all', verifyToken, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { data, error } = await supabaseAdmin.from('investigator_passes').select('*, user:profiles!investigator_passes_user_id_fkey(full_name, designation, department, state, district)').order('created_at', { ascending:false }).limit(100);
  if (error) { res.status(500).json({ success:false, error:error.message }); return; }
  res.json({ success:true, data: data||[] });
}));

// POST /api/investigator-passes — admin creates pass for a user
router.post('/', verifyToken, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const adminId = req.user!.id;
  const { user_id, des_name, state, district, designation, photo_url, valid_until } = req.body;
  if (!user_id || !des_name || !state || !designation) {
    res.status(400).json({ success:false, error:'user_id, des_name, state, designation required' }); return;
  }
  const code = genPassCode();
  const { data, error } = await supabaseAdmin.from('investigator_passes').insert({
    user_id, des_name, state, district: district||state, designation, photo_url: photo_url||null, verification_code: code, issued_by: adminId, valid_until: valid_until || new Date(Date.now()+365*24*60*60*1000).toISOString().slice(0,10)
  }).select().single();
  if (error) { res.status(500).json({ success:false, error:error.message }); return; }
  res.status(201).json({ success:true, data: { ...data, verify_url: `${process.env.FRONTEND_URL||'http://localhost:3000'}/verify/pass/${code}` } });
}));

// GET /api/investigator-passes/verify/:code — public verification (no auth)
router.get('/verify/:code', asyncHandler(async (req, res: Response) => {
  const { code } = req.params;
  const { data, error } = await supabaseAdmin.from('investigator_passes').select('*, user:profiles!investigator_passes_user_id_fkey(full_name, designation, department, state, district, photo_url)').eq('verification_code', code).single();
  if (error || !data) { res.status(404).json({ success:false, error:'Pass not found or invalid' }); return; }
  const expired = data.valid_until && new Date(data.valid_until) < new Date();
  res.json({ success:true, data: { verified: !expired, expired: !!expired, pass: data, holder: data.user } });
}));

// GET /api/investigator-passes/qr/:code — returns verify URL + QR API URL (frontend can render directly)
router.get('/qr/:code', asyncHandler(async (req, res: Response) => {
  const { code } = req.params;
  const { data } = await supabaseAdmin.from('investigator_passes').select('verification_code, state, des_name').eq('verification_code', code).maybeSingle();
  if (!data) { res.status(404).json({ success:false, error:'Not found' }); return; }
  const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify/pass/${code}`;
  res.json({ success:true, data: { verification_code: code, verify_url: verifyUrl, qr_api_url: `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(verifyUrl)}` } });
}));

export default router;
