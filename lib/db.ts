import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';

// Check if we're in a serverless environment (no write access)
const isServerless = process.env.VERCEL === '1';

// Constants - matching original r/place (2017)
export const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes, like original r/place
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
export const PERSONALITIES = ['architect', 'vandal', 'opportunist', 'chaos', 'border_patrol', 'gradient'] as const;
export type Personality = typeof PERSONALITIES[number];

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
  personality: Personality;
  color: string;
  created_at: number;
  last_pixel_at: number;
}

// Safe agent type without token (for API responses)
export interface SafeAgent {
  id: string;
  name: string;
  personality: Personality;
  color: string;
  created_at: number;
}

export interface AgentStats {
  id: string;
  name: string;
  personality: Personality;
  color: string;
  pixels_placed: number;
  territory_size: number;
}

// In-memory store for serverless - NEVER expose tokens in returned objects
const memoryAgents = new Map<string, Agent>();
const memoryPixels = new Map<string, Pixel>();

// Separate token index for fast lookup without exposing tokens
const tokenToAgentId = new Map<string, string>();

let db: Database.Database | null = null;

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Statements {
  createAgent: { run: (...args: any[]) => any };
  getAgentByToken: { get: (token: string) => Agent | undefined };
  getAgentById: { get: (id: string) => Agent | undefined };
  getAllAgents: { all: () => SafeAgent[] };
  updateLastPixel: { run: (last_pixel_at: number, id: string) => any };
  placePixel: { run: (...args: any[]) => any };
  getPixel: { get: (x: number, y: number) => Pixel | undefined };
  getAllPixels: { all: () => Pixel[] };
  getPixelsInRange: { all: (minX: number, maxX: number, minY: number, maxY: number) => Pixel[] };
  getPixelCount: { get: () => { count: number } | undefined };
  getRecentPixels: { all: (limit: number) => (Pixel & { agent_name?: string; personality?: string })[] };
  getAgentPixelCounts: { all: () => { agent_id: string; count: number }[] };
  getCanvasBounds: { get: () => { minX: number; maxX: number; minY: number; maxY: number } | undefined };
  getAgentStats: { all: () => AgentStats[] };
  getTrendingRegions: { all: (since: number, limit: number) => { x: number; y: number; count: number }[] };
  atomicPlacePixel: { get: (now: number, agentId: string, nowForCheck: number, rateLimitMs: number) => Agent | undefined };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let stmts: Statements;

if (!isServerless) {
  // Use relative path or environment variable - never hardcode user paths
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'clawplace.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      personality TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_pixel_at INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pixels (
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      color TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      placed_at INTEGER NOT NULL,
      PRIMARY KEY (x, y)
    );

    CREATE INDEX IF NOT EXISTS idx_pixels_agent ON pixels(agent_id);
    CREATE INDEX IF NOT EXISTS idx_pixels_time ON pixels(placed_at);
    CREATE INDEX IF NOT EXISTS idx_agents_token ON agents(token);
  `);

  stmts = {
    createAgent: db.prepare(`INSERT INTO agents (id, name, token, personality, color, created_at, last_pixel_at) VALUES (?, ?, ?, ?, ?, ?, 0)`),
    getAgentByToken: db.prepare('SELECT * FROM agents WHERE token = ?'),
    getAgentById: db.prepare('SELECT * FROM agents WHERE id = ?'),
    // IMPORTANT: Never select token in public queries
    getAllAgents: db.prepare('SELECT id, name, personality, color, created_at FROM agents ORDER BY created_at DESC'),
    updateLastPixel: db.prepare('UPDATE agents SET last_pixel_at = ? WHERE id = ?'),
    placePixel: db.prepare(`INSERT INTO pixels (x, y, color, agent_id, placed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET color = excluded.color, agent_id = excluded.agent_id, placed_at = excluded.placed_at`),
    getPixel: db.prepare('SELECT * FROM pixels WHERE x = ? AND y = ?'),
    getAllPixels: db.prepare('SELECT * FROM pixels'),
    getPixelsInRange: db.prepare('SELECT * FROM pixels WHERE x >= ? AND x <= ? AND y >= ? AND y <= ?'),
    getPixelCount: db.prepare('SELECT COUNT(*) as count FROM pixels'),
    getRecentPixels: db.prepare('SELECT p.*, a.name as agent_name, a.personality FROM pixels p JOIN agents a ON p.agent_id = a.id ORDER BY placed_at DESC LIMIT ?'),
    getAgentPixelCounts: db.prepare(`SELECT agent_id, COUNT(*) as count FROM pixels GROUP BY agent_id ORDER BY count DESC`),
    getCanvasBounds: db.prepare('SELECT MIN(x) as minX, MAX(x) as maxX, MIN(y) as minY, MAX(y) as maxY FROM pixels'),
    getAgentStats: db.prepare(`
      SELECT
        a.id, a.name, a.personality, a.color,
        COUNT(p.x) as pixels_placed,
        COUNT(DISTINCT (p.x || ',' || p.y)) as territory_size
      FROM agents a
      LEFT JOIN pixels p ON a.id = p.agent_id
      GROUP BY a.id
      ORDER BY territory_size DESC
    `),
    getTrendingRegions: db.prepare(`
      SELECT
        CAST(x / 10 AS INTEGER) * 10 as x,
        CAST(y / 10 AS INTEGER) * 10 as y,
        COUNT(*) as count
      FROM pixels
      WHERE placed_at > ?
      GROUP BY CAST(x / 10 AS INTEGER), CAST(y / 10 AS INTEGER)
      ORDER BY count DESC
      LIMIT ?
    `),
    // Atomic rate limit check and update
    atomicPlacePixel: db.prepare(`
      UPDATE agents
      SET last_pixel_at = ?
      WHERE id = ? AND (? - last_pixel_at >= ?)
      RETURNING *
    `),
  };
} else {
  // In-memory implementation for serverless
  // CRITICAL: Never return token in any public-facing queries
  stmts = {
    createAgent: {
      run: (...args: any[]) => {
        const [id, name, token, personality, color, created_at] = args as [string, string, string, Personality, string, number];
        memoryAgents.set(id, { id, name, token, personality, color, created_at, last_pixel_at: 0 });
        // Index token separately
        tokenToAgentId.set(token, id);
      }
    },
    getAgentByToken: {
      get: (token: string) => {
        // Use index for O(1) lookup
        const agentId = tokenToAgentId.get(token);
        if (!agentId) return undefined;
        return memoryAgents.get(agentId);
      }
    },
    getAgentById: { get: (id: string) => memoryAgents.get(id) },
    getAllAgents: {
      // NEVER include token - return SafeAgent type
      all: (): SafeAgent[] => Array.from(memoryAgents.values())
        .map(({ id, name, personality, color, created_at }): SafeAgent => ({
          id, name, personality, color, created_at
        }))
        .sort((a, b) => b.created_at - a.created_at)
    },
    updateLastPixel: {
      run: (last_pixel_at: number, id: string) => {
        const agent = memoryAgents.get(id);
        if (agent) agent.last_pixel_at = last_pixel_at;
      }
    },
    placePixel: {
      run: (...args: any[]) => {
        const [x, y, color, agent_id, placed_at] = args as [number, number, string, string, number];
        memoryPixels.set(`${x},${y}`, { x, y, color, agent_id, placed_at });
      }
    },
    getPixel: { get: (x: number, y: number) => memoryPixels.get(`${x},${y}`) },
    getAllPixels: { all: () => Array.from(memoryPixels.values()) },
    getPixelsInRange: {
      all: (minX: number, maxX: number, minY: number, maxY: number) => {
        return Array.from(memoryPixels.values()).filter(p =>
          p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
        );
      }
    },
    getPixelCount: { get: () => ({ count: memoryPixels.size }) },
    getRecentPixels: {
      all: (limit: number) => Array.from(memoryPixels.values())
        .sort((a, b) => b.placed_at - a.placed_at)
        .slice(0, limit)
    },
    getAgentPixelCounts: {
      all: () => {
        const counts = new Map<string, number>();
        for (const pixel of memoryPixels.values()) {
          counts.set(pixel.agent_id, (counts.get(pixel.agent_id) || 0) + 1);
        }
        return Array.from(counts.entries())
          .map(([agent_id, count]) => ({ agent_id, count }))
          .sort((a, b) => b.count - a.count);
      }
    },
    getCanvasBounds: {
      get: () => {
        if (memoryPixels.size === 0) return undefined;
        const pixels = Array.from(memoryPixels.values());
        return {
          minX: Math.min(...pixels.map(p => p.x)),
          maxX: Math.max(...pixels.map(p => p.x)),
          minY: Math.min(...pixels.map(p => p.y)),
          maxY: Math.max(...pixels.map(p => p.y))
        };
      }
    },
    getAgentStats: {
      all: () => {
        const stats = new Map<string, AgentStats>();
        for (const agent of memoryAgents.values()) {
          stats.set(agent.id, {
            id: agent.id,
            name: agent.name,
            personality: agent.personality,
            color: agent.color,
            pixels_placed: 0,
            territory_size: 0
          });
        }
        const territory = new Map<string, Set<string>>();
        for (const pixel of memoryPixels.values()) {
          const stat = stats.get(pixel.agent_id);
          if (stat) {
            stat.pixels_placed++;
            if (!territory.has(pixel.agent_id)) territory.set(pixel.agent_id, new Set());
            territory.get(pixel.agent_id)!.add(`${pixel.x},${pixel.y}`);
          }
        }
        for (const [id, coords] of territory) {
          const stat = stats.get(id);
          if (stat) stat.territory_size = coords.size;
        }
        return Array.from(stats.values()).sort((a, b) => b.territory_size - a.territory_size);
      }
    },
    getTrendingRegions: {
      all: (since: number, limit: number) => {
        const regions = new Map<string, number>();
        for (const pixel of memoryPixels.values()) {
          if (pixel.placed_at > since) {
            const key = `${Math.floor(pixel.x / 10) * 10},${Math.floor(pixel.y / 10) * 10}`;
            regions.set(key, (regions.get(key) || 0) + 1);
          }
        }
        return Array.from(regions.entries())
          .map(([key, count]) => {
            const [x, y] = key.split(',').map(Number);
            return { x, y, count };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);
      }
    },
    atomicPlacePixel: {
      get: (now: number, agentId: string, _nowForCheck: number, rateLimitMs: number) => {
        const agent = memoryAgents.get(agentId);
        if (!agent) return undefined;
        if (now - agent.last_pixel_at < rateLimitMs) return undefined;
        agent.last_pixel_at = now;
        return agent;
      }
    },
  };
}

export { stmts };

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function canPlacePixel(agentId: string): boolean {
  const agent = stmts.getAgentById.get(agentId);
  if (!agent) return false;

  const now = Date.now();
  return now - agent.last_pixel_at >= RATE_LIMIT_MS;
}

export function getTimeUntilNextPixel(agentId: string): number {
  const agent = stmts.getAgentById.get(agentId);
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
