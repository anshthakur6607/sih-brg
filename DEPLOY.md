Render/Railway deployment notes for sih-brg

Goal: run `sih-brg` as a persistent Node service (not serverless) so WebSocket upgrades work.

1. Environment variables
- AI_SERVICE_WS_URL: https://sih-aiservice-skillup-production.up.railway.app  # Render/Railway will be converted to wss:// by wsProxy
- PORT: leave unset (Render/Railway provide it), but ensure your start command uses `process.env.PORT`.
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, other secrets as required

2. Render settings
- Runtime: Node
- Build Command: `npm run build`
- Start Command: `npm run start`
- Health Check: optional HTTP health check to `/health` on the provided port.
- Environment: add variables above in Render dashboard.

3. Railway
- Create a new service, link repo, set start command to `npm run start` and build step `npm run build`.
- Add environment variables in Railway project settings.
- Verify logs show: "mounted on ws://<host>:<port>/ws/live-tutor → <AI_SERVICE_WS_URL>/ws/live-tutor"

4. Local verification
- Build and run locally:
  npm install
  npm run build
  PORT=3001 npm start
- Test:
  wscat -c "wss://<your-backend-domain>/ws/live-tutor?token=TEST"
  curl -I https://<your-backend-domain>/ws/live-tutor

Notes:
- AI_SERVICE_WS_URL can be set to the Railway AI service HTTP URL (https://...), wsProxy will use wss:// automatically.
- Ensure TLS (wss://) in production.
