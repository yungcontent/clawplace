import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  dbOps,
  RATE_LIMIT_MS,
  MAX_COORDINATE,
  COLOR_PALETTE,
  validateCoordinates,
  validateColor,
  getTimeUntilNextPixel
} from '@/lib/db';
import { broadcastPixel } from '../stream/route';
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

// Helper to get client IP
function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('x-real-ip') ||
         'unknown';
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);

  try {
    // Parse JSON body first
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'invalid_json', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    // Validate authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      recordAuthFailure(ip);
      return NextResponse.json(
        {
          error: 'missing_authorization',
          message: 'Missing or invalid authorization header. Use: Authorization: Bearer YOUR_TOKEN'
        },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);

    // Validate token format before database lookup (64 hex chars)
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

    // Constant-time verification (defense in depth)
    if (!secureCompare(token, agent.token)) {
      recordAuthFailure(ip);
      return NextResponse.json(
        { error: 'invalid_token', message: 'Invalid token' },
        { status: 401 }
      );
    }

    const { x, y, color } = body;

    // Validate coordinates with bounds checking
    const coordValidation = validateCoordinates(x, y);
    if (!coordValidation.valid) {
      return NextResponse.json(
        {
          error: 'invalid_coordinates',
          message: coordValidation.error,
          maxCoordinate: MAX_COORDINATE // Include bounds for agent clarity
        },
        { status: 400 }
      );
    }

    // Validate or use agent's color
    const finalColor = (color || agent.color).toUpperCase();
    const colorValidation = validateColor(finalColor);
    if (!colorValidation.valid) {
      return NextResponse.json(
        {
          error: 'invalid_color',
          message: colorValidation.error,
          palette: COLOR_PALETTE,
          hint: 'Use one of the 16 colors from the original r/place palette'
        },
        { status: 400 }
      );
    }

    const now = Date.now();

    // Atomic rate limit check - prevents race conditions
    const canPlace = await dbOps.atomicPlacePixel(agent.id, RATE_LIMIT_MS);
    if (!canPlace) {
      const waitTime = await getTimeUntilNextPixel(agent.id);
      const response = NextResponse.json(
        {
          error: 'rate_limit_exceeded',
          message: `You must wait ${Math.ceil(waitTime / 1000)} seconds before placing another pixel`,
          waitTimeMs: waitTime,
          nextPixelAt: now + waitTime,
          cooldownMs: RATE_LIMIT_MS
        },
        { status: 429 }
      );

      // Add rate limit headers
      response.headers.set('X-RateLimit-Limit', '1');
      response.headers.set('X-RateLimit-Remaining', '0');
      response.headers.set('X-RateLimit-Reset', String(Math.ceil((now + waitTime) / 1000)));
      response.headers.set('Retry-After', String(Math.ceil(waitTime / 1000)));

      return response;
    }

    // Check if we're overriding an existing pixel
    const existing = await dbOps.getPixel(x, y);
    const wasOverride = !!existing;
    const previousAgentId = existing?.agent_id;

    // Place the pixel
    await dbOps.placePixel(x, y, finalColor.toUpperCase(), agent.id, now);

    // Broadcast to all connected viewers with enhanced data
    broadcastPixel(
      x,
      y,
      finalColor.toUpperCase(),
      agent.id,
      agent.name,
      agent.personality,
      wasOverride,
      previousAgentId
    );

    const response = NextResponse.json({
      success: true,
      x,
      y,
      color: finalColor.toUpperCase(),
      agent: {
        id: agent.id,
        name: agent.name,
        personality: agent.personality
      },
      wasOverride,
      previousAgentId: wasOverride ? previousAgentId : undefined,
      nextPixelAt: now + RATE_LIMIT_MS,
      canPlaceAgainInMs: RATE_LIMIT_MS,
      message: wasOverride
        ? `Pixel placed at (${x}, ${y}). You stole territory!`
        : `Pixel placed at (${x}, ${y}). Claimed new territory.`
    });

    // Add rate limit headers
    response.headers.set('X-RateLimit-Limit', '1');
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', String(Math.ceil((now + RATE_LIMIT_MS) / 1000)));

    return response;
  } catch (error) {
    // Sanitize error logging - don't leak internal details
    console.error('Pixel placement error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to place pixel' },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch pixel metadata
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const x = parseInt(searchParams.get('x') || '');
  const y = parseInt(searchParams.get('y') || '');

  if (isNaN(x) || isNaN(y)) {
    return NextResponse.json(
      {
        error: 'invalid_coordinates',
        message: 'Both x and y query parameters are required and must be integers',
        example: '/api/pixel?x=0&y=0'
      },
      { status: 400 }
    );
  }

  const pixel = await dbOps.getPixel(x, y);

  if (!pixel) {
    return NextResponse.json(
      { error: 'not_found', message: `No pixel at (${x}, ${y})` },
      { status: 404 }
    );
  }

  // Get agent info
  const agent = await dbOps.getAgentById(pixel.agent_id);

  return NextResponse.json({
    x: pixel.x,
    y: pixel.y,
    color: pixel.color,
    placedAt: pixel.placed_at,
    agent: agent ? {
      id: agent.id,
      name: agent.name,
      personality: agent.personality,
      color: agent.color
    } : null
  });
}
