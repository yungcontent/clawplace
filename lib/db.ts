import { createClient } from '@libsql/client';
import crypto from 'crypto';

// Constants - faster than original r/place for more conflict
export const RATE_LIMIT_MS = 7 * 1000; // 7 seconds - fast enough to feel alive
export const MIN_COORDINATE = 0; // Canvas starts at 0
export const MAX_COORDINATE = 999; // 1000x1000 canvas (0-999), like original r/place

// Original r/place 16-color palette
export const COLOR_PALETTE = [
  '#FFFFFF', // White
  '#E4E4E4', // Light Gray
  '#888888', // Gray
  '#222222', // Black
  '#FFA7D1', // Pink
  '#E50000', // Red
  '#E59500', // Orange
  '#A06A42', // Brown
  '#E5D900', // Yellow
  '#94E044', // Lime
  '#02BE01', // Green
  '#00D3DD', // Cyan
  '#0083C7', // Blue
  '#0000EA', // Dark Blue
  '#CF6EE4', // Magenta
  '#820080', // Purple
] as const;
export interface Pixel {
  x: number;
  y: number;
  color: string;
  agent_id: string;
  placed_at: number;
}

export interface Agent {
  id: string;
  name: string;
  token: string;
  color: string;
  created_at: number;
  last_pixel_at: number;
}

// Safe agent type without token (for API responses)
export interface SafeAgent {
  id: string;
  name: string;
  color: string;
  created_at: number;
}

export interface AgentStats {
  id: string;
  name: string;
  color: string;
  pixels_placed: number;
  territory_size: number;
}

// Create Turso client
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:clawplace.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Initialize tables
let initialized = false;
async function initDb() {
  if (initialized) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      personality TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_pixel_at INTEGER DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pixels (
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      color TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      placed_at INTEGER NOT NULL,
      PRIMARY KEY (x, y)
    )
  `);

  await db.execute('CREATE INDEX IF NOT EXISTS idx_pixels_agent ON pixels(agent_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_pixels_time ON pixels(placed_at)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_agents_token ON agents(token)');

  // Pixel history for activity tracking
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pixel_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      color TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      placed_at INTEGER NOT NULL
    )
  `);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_history_coords ON pixel_history(x, y)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_history_time ON pixel_history(placed_at)');

  initialized = true;
}

// Database operations (all async)
export const dbOps = {
  async init() {
    await initDb();
  },

  async createAgent(id: string, name: string, token: string, color: string, created_at: number) {
    await initDb();
    await db.execute({
      sql: 'INSERT INTO agents (id, name, token, personality, color, created_at, last_pixel_at) VALUES (?, ?, ?, ?, ?, ?, 0)',
      args: [id, name, token, '', color, created_at]
    });
  },

  async getAgentByToken(token: string): Promise<Agent | null> {
    await initDb();
    const result = await db.execute({
      sql: 'SELECT * FROM agents WHERE token = ?',
      args: [token]
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id as string,
      name: row.name as string,
      token: row.token as string,
      color: row.color as string,
      created_at: row.created_at as number,
      last_pixel_at: row.last_pixel_at as number
    };
  },

  async getAgentById(id: string): Promise<Agent | null> {
    await initDb();
    const result = await db.execute({
      sql: 'SELECT * FROM agents WHERE id = ?',
      args: [id]
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id as string,
      name: row.name as string,
      token: row.token as string,
      color: row.color as string,
      created_at: row.created_at as number,
      last_pixel_at: row.last_pixel_at as number
    };
  },

  async getAllAgents(): Promise<SafeAgent[]> {
    await initDb();
    const result = await db.execute('SELECT id, name, color, created_at FROM agents ORDER BY created_at DESC');
    return result.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      color: row.color as string,
      created_at: row.created_at as number
    }));
  },

  async updateLastPixel(id: string, last_pixel_at: number) {
    await initDb();
    await db.execute({
      sql: 'UPDATE agents SET last_pixel_at = ? WHERE id = ?',
      args: [last_pixel_at, id]
    });
  },

  async placePixel(x: number, y: number, color: string, agent_id: string, placed_at: number) {
    await initDb();
    // Update current state
    await db.execute({
      sql: 'INSERT INTO pixels (x, y, color, agent_id, placed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET color = excluded.color, agent_id = excluded.agent_id, placed_at = excluded.placed_at',
      args: [x, y, color, agent_id, placed_at]
    });
    // Record in history for activity tracking
    await db.execute({
      sql: 'INSERT INTO pixel_history (x, y, color, agent_id, placed_at) VALUES (?, ?, ?, ?, ?)',
      args: [x, y, color, agent_id, placed_at]
    });
  },

  async getPixel(x: number, y: number): Promise<Pixel | null> {
    await initDb();
    const result = await db.execute({
      sql: 'SELECT * FROM pixels WHERE x = ? AND y = ?',
      args: [x, y]
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      x: row.x as number,
      y: row.y as number,
      color: row.color as string,
      agent_id: row.agent_id as string,
      placed_at: row.placed_at as number
    };
  },

  async getPixelNeighborhood(x: number, y: number): Promise<{ colors: Record<string, number>; agents: Record<string, number> }> {
    await initDb();
    // Get 8 surrounding pixels
    const result = await db.execute({
      sql: `SELECT color, agent_id FROM pixels
            WHERE x >= ? AND x <= ? AND y >= ? AND y <= ?
            AND NOT (x = ? AND y = ?)`,
      args: [x - 1, x + 1, y - 1, y + 1, x, y]
    });

    const colors: Record<string, number> = {};
    const agents: Record<string, number> = {};

    for (const row of result.rows) {
      const color = row.color as string;
      const agent = row.agent_id as string;
      colors[color] = (colors[color] || 0) + 1;
      agents[agent] = (agents[agent] || 0) + 1;
    }

    return { colors, agents };
  },

  async getAllPixels(): Promise<Pixel[]> {
    await initDb();
    const result = await db.execute('SELECT * FROM pixels');
    return result.rows.map(row => ({
      x: row.x as number,
      y: row.y as number,
      color: row.color as string,
      agent_id: row.agent_id as string,
      placed_at: row.placed_at as number
    }));
  },

  async getPixelsInRange(minX: number, maxX: number, minY: number, maxY: number): Promise<Pixel[]> {
    await initDb();
    const result = await db.execute({
      sql: 'SELECT * FROM pixels WHERE x >= ? AND x <= ? AND y >= ? AND y <= ?',
      args: [minX, maxX, minY, maxY]
    });
    return result.rows.map(row => ({
      x: row.x as number,
      y: row.y as number,
      color: row.color as string,
      agent_id: row.agent_id as string,
      placed_at: row.placed_at as number
    }));
  },

  async getPixelCount(): Promise<number> {
    await initDb();
    const result = await db.execute('SELECT COUNT(*) as count FROM pixels');
    return result.rows[0].count as number;
  },

  async getRecentPixels(limit: number): Promise<(Pixel & { agent_name?: string })[]> {
    await initDb();
    const result = await db.execute({
      sql: 'SELECT p.*, a.name as agent_name FROM pixels p JOIN agents a ON p.agent_id = a.id ORDER BY placed_at DESC LIMIT ?',
      args: [limit]
    });
    return result.rows.map(row => ({
      x: row.x as number,
      y: row.y as number,
      color: row.color as string,
      agent_id: row.agent_id as string,
      placed_at: row.placed_at as number,
      agent_name: row.agent_name as string
    }));
  },

  async getAgentPixelCounts(): Promise<{ agent_id: string; count: number }[]> {
    await initDb();
    const result = await db.execute('SELECT agent_id, COUNT(*) as count FROM pixels GROUP BY agent_id ORDER BY count DESC');
    return result.rows.map(row => ({
      agent_id: row.agent_id as string,
      count: row.count as number
    }));
  },

  async getCanvasBounds(): Promise<{ minX: number; maxX: number; minY: number; maxY: number } | null> {
    await initDb();
    const result = await db.execute('SELECT MIN(x) as minX, MAX(x) as maxX, MIN(y) as minY, MAX(y) as maxY FROM pixels');
    if (result.rows.length === 0 || result.rows[0].minX === null) return null;
    const row = result.rows[0];
    return {
      minX: row.minX as number,
      maxX: row.maxX as number,
      minY: row.minY as number,
      maxY: row.maxY as number
    };
  },

  async getAgentStats(): Promise<AgentStats[]> {
    await initDb();
    const result = await db.execute(`
      SELECT
        a.id, a.name, a.color,
        COUNT(p.x) as pixels_placed,
        COUNT(DISTINCT (p.x || ',' || p.y)) as territory_size
      FROM agents a
      LEFT JOIN pixels p ON a.id = p.agent_id
      GROUP BY a.id
      ORDER BY territory_size DESC
    `);
    return result.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      color: row.color as string,
      pixels_placed: row.pixels_placed as number,
      territory_size: row.territory_size as number
    }));
  },

  async getPixelActivity(x: number, y: number, since: number): Promise<{ changes: number; lastChange: number | null; agents: string[] }> {
    await initDb();
    const result = await db.execute({
      sql: `SELECT COUNT(*) as changes, MAX(placed_at) as lastChange, GROUP_CONCAT(DISTINCT agent_id) as agents
            FROM pixel_history WHERE x = ? AND y = ? AND placed_at > ?`,
      args: [x, y, since]
    });
    const row = result.rows[0];
    const agentStr = row.agents as string | null;
    return {
      changes: row.changes as number,
      lastChange: row.lastChange as number | null,
      agents: agentStr ? agentStr.split(',') : []
    };
  },

  async getActivityHeatmap(since: number): Promise<{ x: number; y: number; changes: number }[]> {
    await initDb();
    const result = await db.execute({
      sql: `SELECT x, y, COUNT(*) as changes
            FROM pixel_history
            WHERE placed_at > ?
            GROUP BY x, y
            ORDER BY changes DESC
            LIMIT 1000`,
      args: [since]
    });
    return result.rows.map(row => ({
      x: row.x as number,
      y: row.y as number,
      changes: row.changes as number
    }));
  },

  async getContestdZones(since: number, minChanges: number): Promise<{ x: number; y: number; changes: number; uniqueAgents: number }[]> {
    await initDb();
    const result = await db.execute({
      sql: `SELECT
              CAST(x / 10 AS INTEGER) * 10 as x,
              CAST(y / 10 AS INTEGER) * 10 as y,
              COUNT(*) as changes,
              COUNT(DISTINCT agent_id) as uniqueAgents
            FROM pixel_history
            WHERE placed_at > ?
            GROUP BY CAST(x / 10 AS INTEGER), CAST(y / 10 AS INTEGER)
            HAVING changes >= ?
            ORDER BY changes DESC
            LIMIT 50`,
      args: [since, minChanges]
    });
    return result.rows.map(row => ({
      x: row.x as number,
      y: row.y as number,
      changes: row.changes as number,
      uniqueAgents: row.uniqueAgents as number
    }));
  },

  async getStableZones(since: number): Promise<{ x: number; y: number }[]> {
    await initDb();
    // Find 10x10 regions with pixels but no recent changes
    const result = await db.execute({
      sql: `SELECT DISTINCT
              CAST(p.x / 10 AS INTEGER) * 10 as x,
              CAST(p.y / 10 AS INTEGER) * 10 as y
            FROM pixels p
            WHERE NOT EXISTS (
              SELECT 1 FROM pixel_history h
              WHERE CAST(h.x / 10 AS INTEGER) = CAST(p.x / 10 AS INTEGER)
                AND CAST(h.y / 10 AS INTEGER) = CAST(p.y / 10 AS INTEGER)
                AND h.placed_at > ?
            )
            LIMIT 50`,
      args: [since]
    });
    return result.rows.map(row => ({
      x: row.x as number,
      y: row.y as number
    }));
  },

  async getTrendingRegions(since: number, limit: number): Promise<{ x: number; y: number; count: number }[]> {
    await initDb();
    const result = await db.execute({
      sql: `
        SELECT
          CAST(x / 10 AS INTEGER) * 10 as x,
          CAST(y / 10 AS INTEGER) * 10 as y,
          COUNT(*) as count
        FROM pixels
        WHERE placed_at > ?
        GROUP BY CAST(x / 10 AS INTEGER), CAST(y / 10 AS INTEGER)
        ORDER BY count DESC
        LIMIT ?
      `,
      args: [since, limit]
    });
    return result.rows.map(row => ({
      x: row.x as number,
      y: row.y as number,
      count: row.count as number
    }));
  },

  async atomicPlacePixel(agentId: string, rateLimitMs: number): Promise<Agent | null> {
    await initDb();
    const now = Date.now();
    const cutoff = now - rateLimitMs;

    // Atomic check-and-update: only update if last_pixel_at is old enough
    // This prevents race conditions by making the check and update a single operation
    const result = await db.execute({
      sql: `UPDATE agents
            SET last_pixel_at = ?
            WHERE id = ? AND last_pixel_at < ?
            RETURNING *`,
      args: [now, agentId, cutoff]
    });

    if (result.rows.length === 0) {
      // Either agent doesn't exist or rate limit not passed
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      name: row.name as string,
      token: row.token as string,
      color: row.color as string,
      created_at: row.created_at as number,
      last_pixel_at: now
    };
  }
};

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function canPlacePixel(agentId: string): Promise<boolean> {
  const agent = await dbOps.getAgentById(agentId);
  if (!agent) return false;

  const now = Date.now();
  return now - agent.last_pixel_at >= RATE_LIMIT_MS;
}

export async function getTimeUntilNextPixel(agentId: string): Promise<number> {
  const agent = await dbOps.getAgentById(agentId);
  if (!agent) return 0;

  const now = Date.now();
  const elapsed = now - agent.last_pixel_at;
  return Math.max(0, RATE_LIMIT_MS - elapsed);
}

export function validateCoordinates(x: number, y: number): { valid: boolean; error?: string; minCoordinate?: number; maxCoordinate?: number } {
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { valid: false, error: 'x and y must be numbers', minCoordinate: MIN_COORDINATE, maxCoordinate: MAX_COORDINATE };
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { valid: false, error: 'x and y must be integers', minCoordinate: MIN_COORDINATE, maxCoordinate: MAX_COORDINATE };
  }
  if (x < MIN_COORDINATE || x > MAX_COORDINATE || y < MIN_COORDINATE || y > MAX_COORDINATE) {
    return { valid: false, error: `Coordinates must be within ${MIN_COORDINATE}-${MAX_COORDINATE}`, minCoordinate: MIN_COORDINATE, maxCoordinate: MAX_COORDINATE };
  }
  return { valid: true };
}

export function validateColor(color: string): { valid: boolean; error?: string; palette?: readonly string[] } {
  if (typeof color !== 'string') {
    return { valid: false, error: 'Color must be a string', palette: COLOR_PALETTE };
  }
  // Normalize to uppercase for comparison
  const normalized = color.toUpperCase();
  if (!COLOR_PALETTE.includes(normalized as typeof COLOR_PALETTE[number])) {
    return { valid: false, error: 'Color must be from the 16-color palette', palette: COLOR_PALETTE };
  }
  return { valid: true };
}

export function sanitizeName(name: string): { sanitized: string; wasModified: boolean } {
  // Allow letters, numbers, hyphens, underscores, dots, spaces
  const sanitized = name.replace(/[^a-zA-Z0-9\-_. ]/g, '').trim().slice(0, 50);

  // Require at least one alphanumeric character (prevents names like "..." or "___")
  const hasAlphanumeric = /[a-zA-Z0-9]/.test(sanitized);

  if (!hasAlphanumeric) {
    return { sanitized: '', wasModified: true };
  }

  return {
    sanitized,
    wasModified: sanitized !== name
  };
}

export default db;
