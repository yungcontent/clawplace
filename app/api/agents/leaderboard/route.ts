import { NextResponse } from 'next/server';
import { dbOps } from '@/lib/db';

export async function GET() {
  try {
    const stats = await dbOps.getAgentStats();

    const leaderboard = stats.map((agent, index) => ({
      rank: index + 1,
      id: agent.id,
      name: agent.name,
      color: agent.color,
      pixelsPlaced: agent.pixels_placed,
      territorySize: agent.territory_size
    }));

    return NextResponse.json({
      leaderboard,
      totalAgents: stats.length,
      totalPixels: stats.reduce((sum, a) => sum + a.pixels_placed, 0),
      timestamp: Date.now()
    });
  } catch (error) {
    // Sanitize error logging
    console.error('Leaderboard fetch error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'server_error', message: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
