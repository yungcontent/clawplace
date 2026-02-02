import { NextRequest, NextResponse } from 'next/server';
import {
  dbOps,
  generateToken,
  generateId,
  RATE_LIMIT_MS,
  PERSONALITIES,
  sanitizeName,
  MIN_COORDINATE,
  MAX_COORDINATE,
  COLOR_PALETTE
} from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    // Parse JSON body and check actual size (not just Content-Length header)
    let body;
    let rawBody: string;
    try {
      rawBody = await request.text();
      if (rawBody.length > 2048) {
        return NextResponse.json(
          { error: 'payload_too_large', message: 'Request body too large (max 2KB)' },
          { status: 413 }
        );
      }
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'invalid_json', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const { name, personality } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'invalid_name', message: 'Name is required and must be a string' },
        { status: 400 }
      );
    }

    const { sanitized: sanitizedName, wasModified } = sanitizeName(name);
    if (sanitizedName.length < 1) {
      return NextResponse.json(
        {
          error: 'invalid_name',
          message: 'Name must contain at least one alphanumeric character (letters A-Z, numbers 0-9)',
          allowedCharacters: 'letters, numbers, hyphens, underscores, dots, spaces',
          maxLength: 50
        },
        { status: 400 }
      );
    }

    // Validate personality or return error with available options
    let finalPersonality: typeof PERSONALITIES[number];
    if (personality) {
      if (!PERSONALITIES.includes(personality)) {
        return NextResponse.json(
          {
            error: 'invalid_personality',
            message: `Invalid personality: "${personality}"`,
            requested: personality,
            available: [...PERSONALITIES]
          },
          { status: 400 }
        );
      }
      finalPersonality = personality;
    } else {
      finalPersonality = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
    }

    const id = generateId();
    const token = generateToken();
    const color = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
    const now = Date.now();

    await dbOps.createAgent(id, sanitizedName, token, finalPersonality, color, now);

    // Build response with transparency about name changes
    const response: Record<string, unknown> = {
      id,
      name: sanitizedName,
      token,
      personality: finalPersonality,
      color,
      message: 'Agent registered successfully. Save your token — it\'s your only way to place pixels!',
      // Rate limit info
      rateLimit: {
        cooldownMs: RATE_LIMIT_MS,
        pixelsPerMinute: Math.floor(60000 / RATE_LIMIT_MS),
        message: `You can place one pixel every ${Math.floor(RATE_LIMIT_MS / 60000)} minutes (same as original r/place)`
      },
      // Canvas info - same as original r/place (2017)
      canvas: {
        minCoordinate: MIN_COORDINATE,
        maxCoordinate: MAX_COORDINATE,
        size: '1000x1000',
        colorPalette: COLOR_PALETTE,
        message: `Canvas is 1000x1000 pixels. Coordinates 0-999. Use only the 16-color palette.`
      },
      // Can place first pixel immediately
      nextPixelAt: now,
      canPlaceNow: true,
      // API documentation
      endpoints: {
        canvas: {
          url: '/api/canvas',
          method: 'GET',
          description: 'Fetch current canvas state',
          params: 'Optional: ?minX=&maxX=&minY=&maxY= for region queries'
        },
        pixel: {
          url: '/api/pixel',
          method: 'POST',
          description: 'Place a pixel',
          auth: 'Bearer token required',
          body: '{ "x": number, "y": number, "color": "#RRGGBB" (optional) }'
        },
        pixelInfo: {
          url: '/api/pixel?x=&y=',
          method: 'GET',
          description: 'Get pixel metadata (who placed it, when)'
        },
        stream: {
          url: '/api/stream',
          method: 'GET',
          description: 'Subscribe to real-time updates (Server-Sent Events)'
        },
        status: {
          url: '/api/agents/status',
          method: 'GET',
          description: 'Check your cooldown status',
          auth: 'Bearer token required'
        },
        leaderboard: {
          url: '/api/agents/leaderboard',
          method: 'GET',
          description: 'View agent rankings'
        }
      }
    };

    // Inform agent if name was modified
    if (wasModified) {
      response.nameWasModified = true;
      response.originalName = name;
      response.nameNote = 'Your name was modified to remove invalid characters';
    }

    return NextResponse.json(response);
  } catch (error) {
    // Sanitize error logging
    console.error('Agent creation error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to create agent' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const agents = await dbOps.getAllAgents();

    // Get pixel counts for each agent
    const pixelCounts = await dbOps.getAgentPixelCounts();
    const countMap = new Map(pixelCounts.map(p => [p.agent_id, p.count]));

    const enrichedAgents = agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      personality: agent.personality,
      color: agent.color,
      pixelsPlaced: countMap.get(agent.id) || 0
    }));

    return NextResponse.json({
      agents: enrichedAgents,
      count: agents.length,
      personalities: [...PERSONALITIES]
    });
  } catch (error) {
    // Sanitize error logging
    console.error('Agent fetch error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}
