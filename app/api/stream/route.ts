import { NextRequest, NextResponse } from 'next/server';

// Store connected clients with metadata (internal only)
interface Client {
  controller: ReadableStreamDefaultController;
  connectedAt: number;
  ip: string;
}

const clients = new Map<string, Client>();
const MAX_CLIENTS = 1000;
const CONNECTION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

// Per-IP connection tracking (local to this module)
const connectionsPerIP = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 5;

// Get current viewer count
export function getViewerCount(): number {
  return clients.size;
}

// Broadcast to all connected clients
export function broadcastPixel(
  x: number,
  y: number,
  color: string,
  agentId: string,
  agentName: string,
  personality?: string,
  wasOverride?: boolean,
  previousAgentId?: string
) {
  const message = JSON.stringify({
    type: 'pixel',
    x,
    y,
    color,
    agentId,
    agentName,
    personality,
    wasOverride,
    previousAgentId,
    viewerCount: clients.size,
    timestamp: Date.now()
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(`data: ${message}\n\n`);

  for (const [clientId, client] of clients) {
    try {
      client.controller.enqueue(data);
    } catch {
      // Clean up failed client
      releaseConnection(client.ip);
      clients.delete(clientId);
    }
  }
}

// Broadcast viewer count update
function broadcastViewerCount() {
  const message = JSON.stringify({
    type: 'viewers',
    count: clients.size,
    timestamp: Date.now()
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(`data: ${message}\n\n`);

  for (const [clientId, client] of clients) {
    try {
      client.controller.enqueue(data);
    } catch {
      releaseConnection(client.ip);
      clients.delete(clientId);
    }
  }
}

// Track connection for an IP
function trackConnection(ip: string): boolean {
  const current = connectionsPerIP.get(ip) || 0;
  if (current >= MAX_CONNECTIONS_PER_IP) {
    return false;
  }
  connectionsPerIP.set(ip, current + 1);
  return true;
}

// Release connection for an IP
function releaseConnection(ip: string) {
  const current = connectionsPerIP.get(ip) || 0;
  if (current > 0) {
    connectionsPerIP.set(ip, current - 1);
  }
  if (current <= 1) {
    connectionsPerIP.delete(ip);
  }
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             request.headers.get('x-real-ip') ||
             'unknown';

  // Check global connection limit
  if (clients.size >= MAX_CLIENTS) {
    return NextResponse.json(
      { error: 'capacity_limit', message: 'Server at capacity. Please try again later.' },
      { status: 503 }
    );
  }

  // Check per-IP connection limit
  if (!trackConnection(ip)) {
    return NextResponse.json(
      { error: 'connection_limit', message: 'Too many connections from this IP.' },
      { status: 429 }
    );
  }

  // Internal client ID - never exposed to client
  const internalClientId = crypto.randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Register client
      clients.set(internalClientId, {
        controller,
        connectedAt: Date.now(),
        ip
      });

      // Send initial connection message - NO internal IDs exposed
      const connectMsg = JSON.stringify({
        type: 'connected',
        message: 'Welcome to ClawPlace. Watch the chaos unfold.',
        viewerCount: clients.size,
        timestamp: Date.now()
      });
      controller.enqueue(encoder.encode(`data: ${connectMsg}\n\n`));

      // Broadcast updated viewer count
      broadcastViewerCount();

      // Set connection timeout
      const timeout = setTimeout(() => {
        try {
          controller.close();
        } catch {
          // Already closed
        }
        releaseConnection(ip);
        clients.delete(internalClientId);
        broadcastViewerCount();
      }, CONNECTION_TIMEOUT);

      // Clean up on abort
      request.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        releaseConnection(ip);
        clients.delete(internalClientId);
        broadcastViewerCount();
      });
    },
    cancel() {
      releaseConnection(ip);
      clients.delete(internalClientId);
      broadcastViewerCount();
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

// Keep-alive ping to prevent connection timeouts
setInterval(() => {
  const now = Date.now();
  const ping = JSON.stringify({
    type: 'ping',
    viewerCount: clients.size,
    timestamp: now
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(`data: ${ping}\n\n`);

  for (const [clientId, client] of clients) {
    // Check for stale connections
    if (now - client.connectedAt > CONNECTION_TIMEOUT) {
      releaseConnection(client.ip);
      clients.delete(clientId);
      continue;
    }

    try {
      client.controller.enqueue(data);
    } catch {
      releaseConnection(client.ip);
      clients.delete(clientId);
    }
  }
}, 30000); // Every 30 seconds
