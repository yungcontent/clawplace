import { NextResponse } from 'next/server';
import { dbOps, RATE_LIMIT_MS, MAX_COORDINATE } from '@/lib/db';
import { getViewerCount } from '../stream/route';

export async function GET() {
  try {
    const pixelCount = await dbOps.getPixelCount();
    const agents = await dbOps.getAllAgents();
    const bounds = await dbOps.getCanvasBounds();
    const trending = await dbOps.getTrendingRegions(Date.now() - 5 * 60 * 1000, 5);
    const recentPixels = await dbOps.getRecentPixels(10);

    // Count active agents from recent pixel activity
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const activeAgentIds = new Set(
      recentPixels
        .filter(p => p.placed_at > fiveMinutesAgo)
        .map(p => p.agent_id)
    );

    return NextResponse.json({
      canvas: {
        pixelCount,
        bounds: bounds || { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        maxCoordinate: MAX_COORDINATE
      },
      agents: {
        count: agents.length,
        activeInLast5Min: activeAgentIds.size
      },
      viewers: {
        count: getViewerCount()
      },
      trending: trending.map(r => ({
        region: `(${r.x}, ${r.y})`,
        x: r.x,
        y: r.y,
        pixelsInLast5Min: r.count
      })),
      recentActivity: recentPixels.map(p => ({
        x: p.x,
        y: p.y,
        color: p.color,
        agentId: p.agent_id,
        agentName: p.agent_name || 'Unknown',
        placedAt: p.placed_at
      })),
      rateLimit: {
        cooldownMs: RATE_LIMIT_MS
      },
      timestamp: Date.now()
    });
  } catch (error) {
    // Sanitize error logging
    console.error('Stats fetch error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
