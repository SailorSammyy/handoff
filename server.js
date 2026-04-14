import http from 'http';
import compression from 'compression';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handler as expressMiddleware } from './api/proxy.js';
import { expressMiddleware as subtitleMiddleware } from './api/subtitle.js';
import { getCorsHeaders, CORS_CONFIG } from './api/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const BASE_PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_PORT  = BASE_PORT + 10;

const app = new Hono();

app.get('/health', c => c.json({
  status: 'ok',
  cors: { enabled: CORS_CONFIG.enabled, allowedOrigins: CORS_CONFIG.allowedOrigins },
  timestamp: new Date().toISOString(),
}));

app.get('/',     async c => {
  try { return c.html(await readFile(join(__dirname, 'public', 'index.html'), 'utf-8')); }
  catch { return c.text('Not found', 404); }
});
app.get('/test', async c => {
  try { return c.html(await readFile(join(__dirname, 'public', 'index.html'), 'utf-8')); }
  catch { return c.text('Not found', 404); }
});

app.use('/*', serveStatic({ root: './public' }));

const honoHandler = getRequestListener(app.fetch);

const compress = compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    const ct = res.getHeader('content-type') || '';
    if (/video|audio|image|octet-stream/i.test(ct)) return false;
    return compression.filter(req, res);
  },
  level: 1,
  threshold: 512,
});

function applyCors(req, res) {
  const origin = req.headers.origin
    || req.headers.referer?.split('/').slice(0, 3).join('/') || null;
  const cors = getCorsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
}

function requestHandler(req, res) {
  if (req.url.includes('&url=') && !req.url.includes('?url=')) {
    req.url = req.url.replace(/&(url=)/, '?$1');
  }

  const path = req.url.split('?')[0];
  const method = req.method.toUpperCase();
  if (path === '/api/proxy' || path === '/proxy') {
    if (method === 'GET' || method === 'HEAD') {
      applyCors(req, res);
      expressMiddleware(req, res);
      return;
    }
  }

  if (path === '/api/subtitle' && method === 'GET') {
    applyCors(req, res);
    subtitleMiddleware(req, res);
    return;
  }

  if (method === 'OPTIONS') {
    applyCors(req, res);
    res.setHeader('Access-Control-Max-Age', '86400');
    res.writeHead(204);
    res.end();
    return;
  }

  compress(req, res, () => honoHandler(req, res));
}

const server = http.createServer(requestHandler);

if (process.env.NODE_ENV !== 'production') {
  const origHandler = requestHandler;
  server.on('request', (req) => {
    const t = Date.now();
    req.on('close', () => {
    });
    const origEnd = req.socket?.write;
    console.log(`→ ${req.method} ${req.url.split('?')[0]}`);
  });
}

async function main() {
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.removeListener('error', reject);
        if (port !== BASE_PORT) console.warn(`⚠️  Port ${BASE_PORT} busy — using ${port}`);
        console.log(`\n🚀 http://localhost:${port}`);
        console.log(`📝 /api/proxy?url=<encoded_url>\n`);
        resolve();
      });
    }).catch(err => {
      if (err.code === 'EADDRINUSE' && port < MAX_PORT) {
        console.warn(`Port ${port} in use, trying ${port + 1}…`);
        return;
      }
      console.error('Failed to start:', err.message);
      process.exit(1);
    });

    if (server.listening) break;
  }
}

main();
