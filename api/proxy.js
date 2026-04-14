import { getHeadersForUrl, getCorsHeaders } from './config.js';

let httpAgent  = null;
let httpsAgent = null;
import('http').then(({ Agent }) => {
  httpAgent = new Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32, timeout: 60000 });
}).catch(() => {});
import('https').then(({ Agent }) => {
  httpsAgent = new Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 32, timeout: 60000 });
}).catch(() => {});

const CACHE = {
  m3u8:    'public, s-maxage=60, max-age=30, stale-while-revalidate=300, stale-if-error=86400',
  segment: 'public, s-maxage=14400, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400',
  mp4:     'public, s-maxage=7200, max-age=1800, stale-while-revalidate=3600, stale-if-error=86400',
  vtt:     'public, s-maxage=3600, max-age=1800, stale-while-revalidate=3600, stale-if-error=86400',
  srt:     'public, s-maxage=3600, max-age=1800, stale-while-revalidate=3600, stale-if-error=86400',
  key:     'public, s-maxage=300, max-age=60, stale-while-revalidate=600, stale-if-error=3600',
  image:   'public, s-maxage=14400, max-age=3600, stale-while-revalidate=86400, stale-if-error=86400',
  thumb:   'public, s-maxage=3600, max-age=1800, stale-while-revalidate=3600, stale-if-error=86400',
};

const EXT_CT = new Map([
  ['m3u8','application/vnd.apple.mpegurl'],
  ['mp4','video/mp4'],['webm','video/webm'],['ts','video/mp2t'],
  ['m4s','video/mp4'],['m4v','video/mp4'],['mkv','video/x-matroska'],
  ['avi','video/x-msvideo'],['mov','video/quicktime'],['ogv','video/ogg'],
  ['vtt','text/vtt'],['srt','text/srt'],['key','application/octet-stream'],
  ['html','text/html'],['htm','text/html'],['js','application/javascript'],
  ['css','text/css'],['json','application/json'],['xml','application/xml'],
  ['ico','image/x-icon'],['png','image/png'],['jpg','image/jpeg'],
  ['jpeg','image/jpeg'],['gif','image/gif'],['svg','image/svg+xml'],
  ['webp','image/webp'],['avif','image/avif'],['bmp','image/bmp'],
  ['aac','audio/aac'],['mp3','audio/mpeg'],['ogg','audio/ogg'],
  ['flac','audio/flac'],['wav','audio/wav'],['m4a','audio/mp4'],
]);

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','svg','avif','bmp','ico']);
const VIDEO_EXTS = new Set(['mp4','webm','ts','m4s','m4v','mkv','avi','mov','ogv']);
const AUDIO_EXTS = new Set(['aac','mp3','ogg','flac','wav','m4a']);

function getExt(url) {
  return url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
}

function getContentType(url, upstreamCT) {
  if (upstreamCT && upstreamCT !== 'application/octet-stream') return upstreamCT;
  return EXT_CT.get(getExt(url)) ?? 'application/octet-stream';
}

function getCacheControl(url) {
  const ext = getExt(url);
  if (ext === 'm3u8') return CACHE.m3u8;
  if (ext === 'mp4' || ext === 'm4v') return CACHE.mp4;
  if (ext === 'vtt') return CACHE.vtt;
  if (ext === 'srt') return CACHE.srt;
  if (ext === 'key') return CACHE.key;
  if (IMAGE_EXTS.has(ext)) return CACHE.image;
  return CACHE.segment;
}

function parseHeadersParam(raw) {
  if (!raw) return {};
  for (const fn of [() => JSON.parse(decodeURIComponent(raw)), () => JSON.parse(raw)]) {
    try {
      const p = fn();
      if (p && typeof p === 'object' && !Array.isArray(p)) return p;
    } catch (_) {}
  }
  try {
    const sep = raw.includes(',') ? ',' : '&';
    const out = {};
    for (const pair of raw.split(sep)) {
      const i = pair.indexOf('=');
      if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1)).trim();
    }
    if (Object.keys(out).length) return out;
  } catch (_) {}
  return {};
}

function buildParamAppend(params) {
  const entries = Object.entries(params);
  if (!entries.length) return '';
  return '&' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

function rewriteM3U8(text, baseUrl, proxyBase, params) {
  const append = buildParamAppend(params);
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/URI=["']([^"']+)["']/gi, (m, uri) => {
      try {
        const abs = new URL(uri, baseUrl).href;
        const q = m[4] === '"' ? '"' : "'";
        return `URI=${q}${proxyBase}?url=${encodeURIComponent(abs)}${append}${q}`;
      } catch { return m; }
    })
    .replace(/URI=([^,\s"'][^\s,]*)/gi, (m, uri) => {
      try {
        const abs = new URL(uri, baseUrl).href;
        return `URI="${proxyBase}?url=${encodeURIComponent(abs)}${append}"`;
      } catch { return m; }
    })
    .replace(/^([^#\s][^\s]*)$/gm, line => {
      try {
        const abs = new URL(line.trim(), baseUrl).href;
        return `${proxyBase}?url=${encodeURIComponent(abs)}${append}`;
      } catch { return line; }
    });
}

function rewriteThumbnailVtt(text, baseUrl, proxyBase, params) {
  const append = buildParamAppend(params);
  return text.replace(/^([^\s].*?)(\s*#xywh=[^\s]*)?\s*$/gm, (full, imgPart, frag) => {
    const t = imgPart?.trim();
    if (!t || /^WEBVTT|^(NOTE|STYLE|REGION)\b|-->|^\d+$/.test(t)) return full;
    try {
      const abs = new URL(t, baseUrl).href;
      return `${proxyBase}?url=${encodeURIComponent(abs)}${append}${frag ?? ''}`;
    } catch { return full; }
  });
}

function titleCase(header) {
  return header.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('-');
}

function pipeMedia(targetUrl, reqHeaders, clientReq, clientRes) {
  return new Promise(async (resolve) => {
    const isHttps = targetUrl.startsWith('https');
    const { request } = await import(isHttps ? 'https' : 'http');
    const parsed = new URL(targetUrl);
    const isHead = clientReq.method.toUpperCase() === 'HEAD';

    const upReq = request({
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   isHead ? 'HEAD' : 'GET',
      headers:  reqHeaders,
      agent:    isHttps ? httpsAgent : httpAgent,
      timeout:  30000,
    }, upRes => {
      const status = upRes.statusCode ?? 200;
      const headers = { 'Accept-Ranges': 'bytes' };

      for (const key of ['content-type','content-length','content-range','etag','last-modified','cache-control']) {
        if (upRes.headers[key]) headers[titleCase(key)] = upRes.headers[key];
      }

      if (isHead) {
        clientRes.writeHead(status, headers);
        clientRes.end();
        upRes.resume();
        resolve();
        return;
      }

      clientRes.writeHead(status, headers);

      clientReq.on('close', () => { upReq.destroy(); resolve(); });

      upRes.pipe(clientRes, { end: true });
      upRes.on('end', resolve);
      upRes.on('error', err => {
        console.error('[UPSTREAM PIPE]', err.message);
        resolve();
      });
    });

    upReq.on('error', err => {
      console.error('[UPSTREAM REQ]', err.message);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ status: 'error', message: err.message }));
      }
      resolve();
    });

    upReq.on('timeout', () => {
      upReq.destroy();
      if (!clientRes.headersSent) {
        clientRes.writeHead(504, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ status: 'error', message: 'Upstream timeout' }));
      }
      resolve();
    });

    upReq.end();
  });
}

export async function expressMiddleware(req, res) {
  let fullUrl = req.url ?? '';
  if (!fullUrl.startsWith('http')) {
    const proto = req.headers['x-forwarded-proto'] ?? (req.socket?.encrypted ? 'https' : 'http');
    const host  = req.headers.host ?? 'localhost:3000';
    fullUrl = `${proto}://${host}${fullUrl}`;
  }

  const url = new URL(fullUrl);
  const enc = url.searchParams.get('url');
  const origin = req.headers.origin
    ?? req.headers.referer?.split('/').slice(0, 3).join('/') ?? null;
  const corsHeaders = getCorsHeaders(origin);

  function sendError(status, message, extra = {}) {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ status: 'error', message, ...extra }, null, 2));
  }

  if (!enc) {
    return sendError(400, 'Usage: /api/proxy?url=<encoded_url>');
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(enc);
    if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
  } catch {
    return sendError(400, 'Invalid URL encoding');
  }

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return sendError(400, 'Invalid URL protocol');
  }

  try {
    const originParam   = url.searchParams.get('origin');
    const headersParam  = url.searchParams.get('headers');
    const customHeaders = parseHeadersParam(headersParam);

    if (originParam) {
      customHeaders['Origin']  = originParam;
      customHeaders['Referer'] ??= originParam;
    }

    const siteHeaders = getHeadersForUrl(targetUrl);
    const range       = req.headers['range'] ?? null;

    const mergedHeaders = {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection':      'keep-alive',
      ...siteHeaders,
      ...customHeaders,
    };
    if (range) mergedHeaders['Range'] = range;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[PROXY] ${range ? `[${range}] ` : ''}${targetUrl.split('/').pop()}`);
    }

    const ext = getExt(targetUrl.split('?')[0]);
    if (VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) {
      for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
      await pipeMedia(targetUrl, mergedHeaders, req, res);
      return;
    }

    const isHead = req.method.toUpperCase() === 'HEAD';
    const upstream = await fetch(targetUrl, {
      method:   isHead ? 'HEAD' : 'GET',
      headers:  new Headers(mergedHeaders),
      redirect: 'follow',
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[UPSTREAM] ${upstream.status} | cl: ${upstream.headers.get('content-length')} | cr: ${upstream.headers.get('content-range')}`);
    }

    if (!upstream.ok && upstream.status !== 206) {
      console.error(`[ERROR] Upstream ${upstream.status} for: ${targetUrl}`);
      return sendError(upstream.status, upstream.statusText, {
        url: targetUrl,
        hint: upstream.status === 403
          ? 'Try adding &origin= or &headers= parameters.'
          : upstream.status === 404 ? 'Resource not found.' : 'Upstream error.',
      });
    }

    const clean  = targetUrl.split('?')[0];
    const isM3U8 = clean.endsWith('.m3u8');
    const isKey  = clean.endsWith('.key');
    const isVtt  = clean.endsWith('.vtt');

    const passParams = {};
    if (originParam)  passParams.origin  = originParam;
    if (headersParam) passParams.headers = headersParam;

    if (isM3U8) {
      const text      = await upstream.text();
      const baseUrl   = targetUrl.slice(0, targetUrl.lastIndexOf('/') + 1);
      const proxyBase = url.origin + url.pathname;
      const rewritten = rewriteM3U8(text, baseUrl, proxyBase, passParams);
      const h = { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': CACHE.m3u8, ...corsHeaders };
      const etag = upstream.headers.get('etag');
      const lm   = upstream.headers.get('last-modified');
      if (etag) h['ETag'] = etag;
      if (lm)   h['Last-Modified'] = lm;
      res.writeHead(200, h);
      res.end(rewritten);
      return;
    }

    if (isVtt) {
      const text      = await upstream.text();
      const baseUrl   = targetUrl.slice(0, targetUrl.lastIndexOf('/') + 1);
      const proxyBase = url.origin + url.pathname;
      const isThumbs  = /#xywh=/i.test(text);
      const body      = isThumbs ? rewriteThumbnailVtt(text, baseUrl, proxyBase, passParams) : text;
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': isThumbs ? CACHE.thumb : CACHE.vtt, ...corsHeaders });
      res.end(body);
      return;
    }

    if (isKey) {
      const h = { 'Content-Type': 'application/octet-stream', 'Cache-Control': CACHE.key, 'Content-Encoding': 'identity', ...corsHeaders };
      const cl = upstream.headers.get('content-length');
      if (cl) h['Content-Length'] = cl;
      res.writeHead(upstream.status, h);
      const { Readable } = await import('stream');
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    const ct    = getContentType(targetUrl, upstream.headers.get('content-type'));
    const cache = getCacheControl(targetUrl);

    if (ct.includes('text/html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache,
        'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
        'X-Frame-Options': 'SAMEORIGIN', ...corsHeaders,
      });
      res.end(await upstream.text());
      return;
    }

    const h = { 'Content-Type': ct, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', ...corsHeaders };
    for (const name of ['content-range','content-length','etag','last-modified']) {
      const val = upstream.headers.get(name);
      if (val) h[titleCase(name)] = val;
    }

    let status = upstream.status;
    if (range && status === 200) { delete h['Content-Range']; }
    if (range && status === 206) { status = 206; }

    if (isHead) { res.writeHead(status, h); res.end(); return; }

    res.writeHead(status, h);
    const { Readable } = await import('stream');
    Readable.fromWeb(upstream.body).pipe(res);

  } catch (err) {
    console.error('[ERROR] Proxy:', err);
    sendError(500, 'Proxy Error', { detail: err.message, url: targetUrl });
  }
}

export const config = { runtime: 'edge' };
export default expressMiddleware;
