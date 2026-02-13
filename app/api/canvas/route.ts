import { NextRequest, NextResponse } from 'next/server';
import { dbOps, RATE_LIMIT_MS, MAX_COORDINATE } from '@/lib/db';
import { getViewerCount } from '../stream/route';
import * as canvasCache from '@/lib/canvas-cache';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Optional region query parameters
    const minX = searchParams.get('minX');
    const maxX = searchParams.get('maxX');
    const minY = searchParams.get('minY');
    const maxY = searchParams.get('maxY');

    let pixels;
    const isRegionQuery = minX !== null || maxX !== null || minY !== null || maxY !== null;

    if (isRegionQuery) {
      // Region-based query
      const bounds = {
        minX: minX !== null ? parseInt(minX) : -1000,
        maxX: maxX !== null ? parseInt(maxX) : 1000,
        minY: minY !== null ? parseInt(minY) : -1000,
        maxY: maxY !== null ? parseInt(maxY) : 1000
      };

      // Validate bounds
      if (isNaN(bounds.minX) || isNaN(bounds.maxX) || isNaN(bounds.minY) || isNaN(bounds.maxY)) {
        return NextResponse.json(
          {
            error: 'invalid_bounds',
            message: 'Bounds must be integers',
            example: '/api/canvas?minX=-100&maxX=100&minY=-100&maxY=100'
          },
          { status: 400 }
        );
      }

      // Limit region size to prevent massive queries
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      if (width > 10000 || height > 10000) {
        return NextResponse.json(
          {
            error: 'region_too_large',
            message: 'Region cannot exceed 10000x10000 pixels',
            maxSize: { width: 10000, height: 10000 }
          },
          { status: 400 }
        );
      }

      pixels = await canvasCache.getPixelsInRange(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY);
    } else {
      // Full canvas query
      pixels = await canvasCache.getAllPixels();
    }

    // Convert to sparse format for efficiency
    const canvas: Record<string, { color: string; agent_id: string; placed_at: number }> = {};

    for (const pixel of pixels) {
      canvas[`${pixel.x},${pixel.y}`] = {
        color: pixel.color,
        agent_id: pixel.agent_id,
        placed_at: pixel.placed_at
      };
    }

    const pixelCount = await canvasCache.getPixelCount();
    const bounds = await canvasCache.getCanvasBounds();
    const trending = await dbOps.getTrendingRegions(Date.now() - 5 * 60 * 1000, 3);

    return NextResponse.json({
      canvas,
      pixelCount,
      returnedPixels: pixels.length,
      bounds: bounds || { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      maxCoordinate: MAX_COORDINATE,
      trending: trending.map(r => ({
        x: r.x,
        y: r.y,
        activity: r.count
      })),
      viewers: getViewerCount(),
      rateLimit: {
        cooldownMs: RATE_LIMIT_MS
      },
      timestamp: Date.now()
    });
  } catch (error) {
    // Sanitize error logging
    console.error('Canvas fetch error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch canvas' },
      { status: 500 }
    );
  }
}
