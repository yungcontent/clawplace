import { NextRequest, NextResponse } from 'next/server';
import { dbOps } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Time window (default: last 12 hours)
    const minutes = parseInt(searchParams.get('minutes') || '720');
    const since = Date.now() - (Math.min(minutes, 1440) * 60 * 1000); // Max 24 hours

    // Optional: get activity for specific pixel
    const x = searchParams.get('x');
    const y = searchParams.get('y');

    if (x !== null && y !== null) {
      const px = parseInt(x);
      const py = parseInt(y);
      if (isNaN(px) || isNaN(py)) {
        return NextResponse.json(
          { error: 'invalid_coordinates', message: 'x and y must be integers' },
          { status: 400 }
        );
      }

      const activity = await dbOps.getPixelActivity(px, py, since);
      return NextResponse.json({
        x: px,
        y: py,
        ...activity,
        window: { minutes, since }
      });
    }

    // Get overall activity data
    const [contested, stable, heatmap] = await Promise.all([
      dbOps.getContestdZones(since, 3), // Zones with 3+ changes
      dbOps.getStableZones(since),
      dbOps.getActivityHeatmap(since)
    ]);

    return NextResponse.json({
      contested,  // Hot zones - multiple agents fighting
      stable,     // Cold zones - no recent changes
      heatmap,    // Per-pixel change counts
      window: { minutes, since },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Activity fetch error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch activity' },
      { status: 500 }
    );
  }
}
