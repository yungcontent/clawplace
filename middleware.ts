import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Rate limiting for auth failures (in-memory, resets on restart)
const authFailures = new Map<string, { count: number; resetAt: number }>();
const AUTH_FAILURE_LIMIT = 10;
const AUTH_FAILURE_WINDOW = 5 * 60 * 1000; // 5 minutes

// Rate limiting for agent registration (in-memory)
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();
const REGISTRATION_LIMIT = 5; // Max 5 registrations per IP
const REGISTRATION_WINDOW = 60 * 60 * 1000; // 1 hour

// Rate limiting for pixel placement by IP (in addition to per-agent)
const pixelAttemptsByIP = new Map<string, { count: number; resetAt: number }>();
const PIXEL_IP_LIMIT = 120; // Max 120 pixels per minute per IP (allows ~2 agents)
const PIXEL_IP_WINDOW = 60 * 1000; // 1 minute

// Note: SSE connection tracking is now handled directly in the stream route
// since middleware runs in edge runtime and can't share state with Node routes

// Allowed origins for CORS (production should set ALLOWED_ORIGINS env var)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// Add production origin if set
if (process.env.PRODUCTION_ORIGIN) {
  ALLOWED_ORIGINS.push(process.env.PRODUCTION_ORIGIN);
}

function getClientIP(request: NextRequest): string {
  // Priority order for trusted IP headers:
  // 1. x-vercel-forwarded-for - Set by Vercel, cannot be spoofed
  // 2. x-real-ip - Set by Vercel/nginx, harder to spoof
  // 3. x-forwarded-for - Can be spoofed, only use as fallback
  // In production, Vercel sets x-vercel-forwarded-for which is trustworthy
  return request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('x-real-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.ip ||
         'unknown';
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // Same-origin requests have no Origin header

  // In development, allow localhost variants
  if (process.env.NODE_ENV !== 'production') {
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return true;
    }
  }

  return ALLOWED_ORIGINS.includes(origin);
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const ip = getClientIP(request);

  // Add security headers to all responses
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Only add HSTS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Content Security Policy - Next.js requires unsafe-inline/unsafe-eval in development
  // In production, consider using nonces for better security
  const cspScriptSrc = process.env.NODE_ENV === 'production'
    ? "'self'"
    : "'self' 'unsafe-inline' 'unsafe-eval'";

  response.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src ${cspScriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none';`
  );

  // CORS for API routes - STRICT ALLOWLIST
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');

    // Only allow whitelisted origins
    if (origin && isOriginAllowed(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Access-Control-Max-Age', '86400');
    } else if (origin) {
      // Block requests from non-allowed origins
      return NextResponse.json(
        { error: 'cors_error', message: 'Origin not allowed' },
        { status: 403 }
      );
    }

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      if (!origin || isOriginAllowed(origin)) {
        const preflightResponse = new NextResponse(null, { status: 204 });
        if (origin) {
          preflightResponse.headers.set('Access-Control-Allow-Origin', origin);
        }
        preflightResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        preflightResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        preflightResponse.headers.set('Access-Control-Max-Age', '86400');
        return preflightResponse;
      }
      return NextResponse.json({ error: 'cors_error' }, { status: 403 });
    }

    // Rate limit agent registration by IP
    if (request.nextUrl.pathname === '/api/agents' && request.method === 'POST') {
      const now = Date.now();
      const record = registrationAttempts.get(ip);

      if (record && record.resetAt > now) {
        if (record.count >= REGISTRATION_LIMIT) {
          return NextResponse.json(
            {
              error: 'registration_rate_limit',
              message: `Too many registrations. Max ${REGISTRATION_LIMIT} agents per hour per IP.`,
              retryAfter: Math.ceil((record.resetAt - now) / 1000)
            },
            {
              status: 429,
              headers: {
                'Retry-After': String(Math.ceil((record.resetAt - now) / 1000))
              }
            }
          );
        }
        record.count++;
      } else {
        registrationAttempts.set(ip, { count: 1, resetAt: now + REGISTRATION_WINDOW });
      }
    }

    // Rate limit auth failures AND pixel placement by IP for /api/pixel
    if (request.nextUrl.pathname === '/api/pixel' && request.method === 'POST') {
      const now = Date.now();

      // Check auth failure rate limit
      const authRecord = authFailures.get(ip);
      if (authRecord && authRecord.resetAt > now && authRecord.count >= AUTH_FAILURE_LIMIT) {
        return NextResponse.json(
          {
            error: 'auth_rate_limit',
            message: 'Too many authentication failures. Try again later.',
            retryAfter: Math.ceil((authRecord.resetAt - now) / 1000)
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((authRecord.resetAt - now) / 1000))
            }
          }
        );
      }

      // Check IP-based pixel rate limit (prevents multi-account abuse)
      const pixelRecord = pixelAttemptsByIP.get(ip);
      if (pixelRecord && pixelRecord.resetAt > now) {
        if (pixelRecord.count >= PIXEL_IP_LIMIT) {
          return NextResponse.json(
            {
              error: 'ip_rate_limit',
              message: `Too many pixel placements from this IP. Max ${PIXEL_IP_LIMIT} per minute.`,
              retryAfter: Math.ceil((pixelRecord.resetAt - now) / 1000)
            },
            {
              status: 429,
              headers: {
                'Retry-After': String(Math.ceil((pixelRecord.resetAt - now) / 1000))
              }
            }
          );
        }
        pixelRecord.count++;
      } else {
        pixelAttemptsByIP.set(ip, { count: 1, resetAt: now + PIXEL_IP_WINDOW });
      }
    }

    // SSE connection limiting is handled in the stream route itself
  }

  return response;
}

// Track auth failure (exported for pixel route to call)
export function recordAuthFailure(ip: string) {
  const now = Date.now();
  const record = authFailures.get(ip);

  if (!record || record.resetAt <= now) {
    authFailures.set(ip, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW });
  } else {
    record.count++;
  }
}

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();

  for (const [ip, record] of authFailures) {
    if (record.resetAt <= now) authFailures.delete(ip);
  }

  for (const [ip, record] of registrationAttempts) {
    if (record.resetAt <= now) registrationAttempts.delete(ip);
  }

  for (const [ip, record] of pixelAttemptsByIP) {
    if (record.resetAt <= now) pixelAttemptsByIP.delete(ip);
  }
}, 60000); // Every minute

export const config = {
  matcher: [
    // Match all paths except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
