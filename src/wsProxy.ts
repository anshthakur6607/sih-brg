/**
 * WebSocket Proxy — bridges browser WebSocket to AI service WebSocket
 *
 * Why: Browser CSP blocks `ws://localhost:8001` (not in connect-src).
 * Backend (port 3001) is same-origin for the browser, so we proxy via /ws/live-tutor.
 *
 * Flow:
 *  1. Browser connects to `ws://localhost:3001/ws/live-tutor?token=<JWT>`
 *  2. We verify JWT via supabaseAdmin.auth.getUser
 *  3. We dial `ws://localhost:8001/ws/live-tutor?token=<JWT>` on the AI service
 *  4. Bidirectional pass-through of all frames (text + binary)
 *  5. Close both sides on either disconnect
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { supabaseAdmin } from './lib/supabase.js';
import { createServer } from 'http';

const AI_SERVICE_WS_URL = process.env.AI_SERVICE_WS_URL || 'ws://127.0.0.1:8001';
const BACKEND_PORT = Number(process.env.PORT || 3001);

let wss: WebSocketServer | null = null;

function log(tag: string, msg: string) {
  console.log(`[ws-proxy ${tag}] ${msg}`);
}

export function attachWebSocketProxy(httpServer: ReturnType<typeof createServer>) {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url) { socket.destroy(); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws/live-tutor') { socket.destroy(); return; }

    wss!.handleUpgrade(req, socket, head, (clientWs) => {
      handleClient(clientWs, url.searchParams.get('token'));
    });
  });

  log('init', `mounted on ws://localhost:${BACKEND_PORT}/ws/live-tutor → ${AI_SERVICE_WS_URL}/ws/live-tutor`);
  return wss;
}

async function handleClient(clientWs: WebSocket, token: string | null) {
  if (!token) { clientWs.close(4401, 'Missing token'); return; }

  // 1. Verify Supabase JWT
  let userId = 'unknown';
  try {
    const { data } = await supabaseAdmin.auth.getUser(token);
    userId = data?.user?.id || 'unknown';
  } catch { clientWs.close(4401, 'Auth error'); return; }

  const tag = `user=${String(userId).slice(0, 8)}`;

  // 2. Dial AI service upstream
  const upstreamUrl = `${AI_SERVICE_WS_URL}/ws/live-tutor?token=${encodeURIComponent(token)}`;
  let upstream: WebSocket;
  try {
    upstream = new WebSocket(upstreamUrl);
    upstream.binaryType = 'arraybuffer';
  } catch (e) {
    log(tag, `upstream connect failed: ${(e as Error).message}`);
    clientWs.close(4403, 'Cannot reach AI service');
    return;
  }

  upstream.on('open', () => {
    log(tag, 'upstream open, bridging');
  });

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      try { clientWs.send(data, { binary: isBinary }); } catch {}
    }
  });

  upstream.on('error', (err) => {
    log(tag, `upstream error: ${err.message}`);
    try { clientWs.send(JSON.stringify({ type: 'error', message: `AI service error: ${err.message}` })); } catch {}
  });

  upstream.on('close', (code, reason) => {
    log(tag, `upstream closed ${code} ${reason}`);
    try { clientWs.close(code, 'Upstream closed'); } catch {}
  });

  // 3. Forward client → upstream
  clientWs.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      try { upstream.send(data, { binary: isBinary }); } catch {}
    }
  });

  clientWs.on('close', (code, reason) => {
    log(tag, `client closed ${code} ${reason}`);
    try { upstream.close(); } catch {}
  });

  clientWs.on('error', (err) => {
    log(tag, `client error: ${err.message}`);
    try { upstream.close(); } catch {}
  });
}
