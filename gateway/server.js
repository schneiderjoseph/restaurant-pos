'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const authRoutes = require('./src/auth.routes');
const { attachRpcRelay } = require('./src/ws-relay');
const { initSurrealClient } = require('./src/surreal-client');
const { verifySession, extractBearer } = require('./src/jwt');

const app = express();
const PORT = Number(process.env.GATEWAY_PORT || 3142);
const HOST = process.env.GATEWAY_HOST || '0.0.0.0';

function parseOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** localhost and 127.0.0.1 are the same host; browsers treat them as different origins. */
function isPrivateLanHostname(hostname) {
  if (!hostname) return false;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // Tailscale CGNAT / common VPN ranges used on POS tablets
  if (/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^26\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

const allowedOrigins = parseOrigins(process.env.GATEWAY_ALLOWED_ORIGINS);
const allowLan = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.GATEWAY_ALLOW_LAN || '').toLowerCase()
);

function originAllowed(origin, allowed) {
  if (allowed.includes('*') || allowed.includes(origin)) {
    return true;
  }
  try {
    const u = new URL(origin);
    const port = u.port ? `:${u.port}` : '';
    const altHost =
      u.hostname === 'localhost'
        ? '127.0.0.1'
        : u.hostname === '127.0.0.1'
          ? 'localhost'
          : null;
    if (altHost && allowed.includes(`${u.protocol}//${altHost}${port}`)) {
      return true;
    }
    // Dev / LAN POS devices: allow private hosts when GATEWAY_ALLOW_LAN is on.
    if (allowLan && isPrivateLanHostname(u.hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, cb) {
      // No Origin header = same-origin or a non-browser caller — always fine.
      if (!origin) {
        return cb(null, true);
      }
      if (originAllowed(origin, allowedOrigins)) {
        // Echo the request origin (required when credentials: true).
        return cb(null, origin);
      }
      console.warn(`[gateway] CORS denied origin=${origin} allowLan=${allowLan}`);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  })
);

app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'posr-gateway' });
});

app.use('/auth', authRoutes);

/** Shared verify endpoint for other services (optional). */
app.post('/auth/verify', async (req, res) => {
  try {
    const token = extractBearer(req) || req.body?.token;
    const payload = await verifySession(token);
    return res.json({ ok: true, session: payload });
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal error' });
});

const server = http.createServer(app);
attachRpcRelay(server);

server.listen(PORT, HOST, () => {
  console.log(`Gateway listening on http://${HOST}:${PORT}`);
  console.log('POST /auth/login');
  console.log('POST /auth/logout');
  console.log('GET  /auth/session');
  console.log('POST /auth/db-token');
  console.log('WS   /rpc (session JWT required)');
});

void initSurrealClient()
  .then(() => console.log('Connected to SurrealDB for auth lookups'))
  .catch((err) => {
    console.warn('SurrealDB connection failed at startup (will retry on request):', err.message);
  });
