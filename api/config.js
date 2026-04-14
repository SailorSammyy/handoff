// Edge Runtime compatible - no dotenv or file system access
// Environment variables should be set directly in Vercel dashboard

export const CORS_CONFIG = {
  enabled: process.env.ENABLE_CORS === 'true',
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['*'],
};

const _allowedSet = new Set(CORS_CONFIG.allowedOrigins);
const _allowAll   = _allowedSet.has('*');

export function getAllowedOrigin(origin) {
  if (!CORS_CONFIG.enabled) return '';
  if (_allowAll) return '*';
  if (origin && _allowedSet.has(origin)) return origin;
  return '';
}

const _corsCache = new Map();

export function getCorsHeaders(origin) {
  const allowed = getAllowedOrigin(origin);
  if (!CORS_CONFIG.enabled || !allowed) return {};

  const cached = _corsCache.get(allowed);
  if (cached) return cached;

  const headers = {
    'Access-Control-Allow-Origin':   allowed,
    'Access-Control-Allow-Methods':  'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers':  'Range, Origin, Content-Type, Accept',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, ETag, Last-Modified',
  };
  _corsCache.set(allowed, headers);
  return headers;
}

export const SITE_CONFIGS = {

  kisskh: {
    domains: ['kisskh.ovh', 'kisskh.la', 'kisskh.ws'],
    headers: {
      'Referer':    'https://kisskh.ovh/',
      'Origin':     'https://kisskh.ovh',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  },

  pro25zone: {
    domains: ['pro25zone.site', 'pro25zone.com'],
    headers: {
      'Referer':    'https://megaup.nl/',
      'Origin':     'https://megaup.nl',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  },

  owocdn: {
    domains: ['owocdn.top', 'vault-99.owocdn.top'],
    headers: {
      'Referer':          'https://animepahe.com/',
      'Origin':           'https://animepahe.com',
      'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':           'application/vnd.apple.mpegurl, application/x-mpegURL, application/json, text/plain, */*',
      'Accept-Language':  'en-US,en;q=0.9',
      'Accept-Encoding':  'gzip, deflate, br',
      'Connection':       'keep-alive',
      'Sec-Fetch-Dest':   'empty',
      'Sec-Fetch-Mode':   'cors',
      'Sec-Fetch-Site':   'cross-site',
      'sec-ch-ua':        '"Not_A Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  },

  animepahe: {
    domains: ['animepahe.com', 'kwik.cs', 'kwik.cx'],
    headers: {
      'Referer':         'https://animepahe.com/',
      'Origin':          'https://animepahe.com',
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection':      'keep-alive',
      'Sec-Fetch-Dest':  'empty',
      'Sec-Fetch-Mode':  'cors',
      'Sec-Fetch-Site':  'same-origin',
    },
  },

  // ── Template ──────────────────────────────────────────────────────────────
  // mysite: {
  //   domains: ['mysite.com', 'mysite.net'],
  //   headers: {
  //     'Referer':    'https://mysite.com/',
  //     'Origin':     'https://mysite.com',
  //     'User-Agent': 'Mozilla/5.0 ...',
  //   },
  // },

};

const _domainMap = new Map();
for (const cfg of Object.values(SITE_CONFIGS)) {
  for (const domain of cfg.domains) {
    _domainMap.set(domain, cfg.headers);
  }
}

export const DEFAULT_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'Sec-Fetch-Dest':  'empty',
  'Sec-Fetch-Mode':  'cors',
  'Sec-Fetch-Site':  'cross-site',
};

export function getHeadersForUrl(targetUrl) {
  try {
    const hostname = new URL(targetUrl).hostname;
    if (_domainMap.has(hostname)) return { ..._domainMap.get(hostname) };
    for (const [domain, headers] of _domainMap) {
      if (hostname.endsWith('.' + domain) || hostname === domain) {
        return { ...headers };
      }
    }
  } catch (_) {}
  return { ...DEFAULT_HEADERS };
}

export default {
  CORS_CONFIG,
  getAllowedOrigin,
  getCorsHeaders,
  SITE_CONFIGS,
  DEFAULT_HEADERS,
  getHeadersForUrl,
};
