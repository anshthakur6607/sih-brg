/**
 * Long-Polling WebSocket Proxy — bridges browser HTTP requests to AI service
 *
 * Why: Vercel serverless functions cannot handle WebSocket Upgrade requests.
 * This endpoint uses long polling (GET with timeout) instead of WS upgrades.
 *
 * Flow:
 *  1. Browser fetches `GET /ws/live-tutor?token=<JWT>` (same-origin via gateway)
 *  2. Gateway verifies JWT via Supabase admin
 *  3. Gateway makes a request to the AI service with the token
 *  4. AI service streams response; gateway forwards it as SSE or JSON polling
 *  5. Client keeps fetching until session ends or timeout
 */

import { supabaseAdmin } from './lib/supabase.js';
import { createServer } from 'http';

const rawAiUrl = process.env.AI_SERVICE_WS_URL || 'https://sih-aiservice-skillup-production.up.railway.app';
let AI_SERVICE_URL: string;
try {
  const tmp = new URL(rawAiUrl.replace(/\/$/, ''));
  AI_SERVICE_URL = `${tmp.protocol}//${tmp.host}`;
} catch {
  AI_SERVICE_URL = rawAiUrl;
}

const BACKEND_PORT = Number(process.env.PORT || 3001);

function log(tag: string, msg: string) {
  console.log(`[ws-proxy ${tag}] ${msg}`);
}

/**
 * Handle GET /ws/live-tutor?token=...
 * Returns SSE stream or JSON polling response.
 */
export function attachLongPollingProxy(httpServer: ReturnType<typeof createServer>) {
  httpServer.get('/ws/live-tutor', async (req, res) => {
    const token = req.query.token as string | undefined;

    if (!token) {
      res.statusCode = 400;
      res.end('Missing token');
      return;
    }

    // 1. Verify Supabase JWT
    let userId = 'unknown';
    try {
      const { data } = await supabaseAdmin.auth.getUser(token);
      userId = data?.user?.id || 'unknown';
    } catch {
      res.statusCode = 401;
      res.end('Auth error');
      return;
    }

    const tag = `user=${String(userId).slice(0, 8)}`;
    log(tag, 'long-poll request received');

    // 2. Dial AI service upstream — make a request with the token
    // The AI service needs to support a token-based endpoint;
    // for now we construct an HTTP request that the FastAPI WS endpoint
    // can also accept as a token-authenticated request, or we fall back
    // to the AI service's HTTP health/check endpoint.
    const aiBase = AI_SERVICE_URL.replace(/^https/, 'http'); // try http fallback
    const aiUrl = `${aiBase}/ws/live-tutor?token=${encodeURIComponent(token)}`;

    // Set a 30-second timeout for the polling round-trip
    const timeoutMs = Number(req.query.timeout ?? '30000');

    // Use SSE to stream responses back to the client
    // Content-Type: text/event-stream; keep-alive
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Make request to AI service
    const aiReq = new (require('http') as any).Request({
      method: 'GET',
      hostname: new URL(aiUrl).host,
      path: new URL(aiUrl).pathname + '?' + new URL(aiUrl).searchParams.toString(),
      headers: {
        'Accept': 'text/event-stream',
      },
    });

    // @ts-ignore — http module types
    const aiHttp = require('http');
    const aiRequest = aiHttp.request(aiUrl, (aiRes) => {
      log(tag, `AI service responded ${aiRes.statusCode}`);
      aiRes.setEncoding('utf8');
      let body = '';

      aiRes.on('data', (chunk) => {
        body += chunk;
      });

      aiRes.on('end', () => {
        // Forward the AI service response as a single SSE message
        try {
          const parsed = JSON.parse(body);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch {
          res.write(`data: ${JSON.stringify({ raw: body })}\n\n`);
        }
        res.end();
      });

      aiRes.on('error', (err) => {
        log(tag, `AI service error: ${err.message}`);
        try {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        } catch {}
        res.end();
      });
    });

    aiRequest.on('error', (err) => {
      log(tag, `AI request error: ${err.message}`);
      try {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      } catch {}
      res.end();
    });

    aiRequest.end();

    // Client-side: set a timeout; if client disconnects, terminate
    const clientTimeout = setTimeout(() => {
      log(tag, 'polling timeout reached');
      try { res.end(); } catch {}
    }, timeoutMs);

    req.on('close', () => {
      log(tag, 'client disconnected');
      clearTimeout(clientTimeout);
      try { aiRequest.destroy(); } catch {}
      try { res.end(); } catch {}
    });
  });
}
