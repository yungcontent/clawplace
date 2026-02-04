import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { dbOps, RATE_LIMIT_MS, getTimeUntilNextPixel } from '@/lib/db';
import { recordAuthFailure } from '@/middleware';

// Constant-time string comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
  // Pad both to same length to prevent length-based timing attacks
  const maxLen = Math.max(a.length, b.length, 1);
  const paddedA = a.padEnd(maxLen, '\0');
  const paddedB = b.padEnd(maxLen, '\0');
  const result = crypto.timingSafeEqual(Buffer.from(paddedA), Buffer.from(paddedB));
  // Also check lengths match (after constant-time compare)
  return result && a.length === b.length;
}

function getClientIP(request: NextRequest): string {
  return request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('x-real-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         'unknown';
}

export async function GET(request: NextRequest) {
  const ip = getClientIP(request);

  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      recordAuthFailure(ip);
      return NextResponse.json(
        {
          error: 'missing_authorization',
          message: 'Bearer token required. Use: Authorization: Bearer YOUR_TOKEN'
        },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);

    // Validate token format
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      recordAuthFailure(ip);
      return NextResponse.json(
        { error: 'invalid_token', message: 'Invalid token format' },
        { status: 401 }
      );
    }

    const agent = await dbOps.getAgentByToken(token);

    if (!agent) {
      recordAuthFailure(ip);
      return NextResponse.json(
        { error: 'invalid_token', message: 'Invalid token' },
        { status: 401 }
      );
    }

    // Constant-time verification
    if (!secureCompare(token, agent.token)) {
      recordAuthFailure(ip);
      return NextResponse.json(
        { error: 'invalid_token', message: 'Invalid token' },
        { status: 401 }
      );
    }

    const now = Date.now();
    const waitTime = await getTimeUntilNextPixel(agent.id);
    const canPlaceNow = waitTime === 0;

    // Get pixel count for this agent
    const pixelCounts = await dbOps.getAgentPixelCounts();
    const myPixels = pixelCounts.find(p => p.agent_id === agent.id);

    return NextResponse.json({
      id: agent.id,
      name: agent.name,
      personality: (agent as any).personality || 'chaos',
      color: agent.color,
      stats: {
        pixelsPlaced: myPixels?.count || 0,
        rank: pixelCounts.findIndex(p => p.agent_id === agent.id) + 1 || pixelCounts.length + 1
      },
      cooldown: {
        canPlaceNow,
        waitTimeMs: waitTime,
        nextPixelAt: canPlaceNow ? now : now + waitTime,
        cooldownMs: RATE_LIMIT_MS
      },
      rateLimit: {
        cooldownMs: RATE_LIMIT_MS,
        pixelsPerMinute: Math.floor(60000 / RATE_LIMIT_MS),
        pixelsPerHour: Math.floor(3600000 / RATE_LIMIT_MS)
      }
    });
  } catch (error) {
    // Sanitize error logging
    console.error('Status fetch error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
