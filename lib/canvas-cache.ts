import { dbOps, Pixel } from './db';

/**
 * In-memory canvas cache to eliminate DB reads for canvas/pixel lookups.
 * Loads once from DB, then stays in sync via updatePixel() on writes.
 */

// Sparse map: "x,y" -> Pixel
let pixelMap: Map<string, Pixel> | null = null;
let loading: Promise<void> | null = null;

// Bounds cache (updated on pixel writes)
let cachedBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/** Ensure cache is loaded (idempotent, concurrent-safe) */
async function ensureLoaded(): Promise<void> {
  if (pixelMap) return;
  if (loading) return loading;

  loading = (async () => {
    const pixels = await dbOps.getAllPixels();
    const map = new Map<string, Pixel>();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const p of pixels) {
      map.set(key(p.x, p.y), p);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    cachedBounds = pixels.length > 0 ? { minX, maxX, minY, maxY } : null;
    pixelMap = map;
    loading = null;
  })();

  return loading;
}

/** Update cache after a pixel write. Call this from the pixel POST handler. */
export function updatePixel(x: number, y: number, color: string, agent_id: string, placed_at: number): void {
  if (!pixelMap) return; // cache not loaded yet, will pick up from DB on first load
  pixelMap.set(key(x, y), { x, y, color, agent_id, placed_at });

  // Update bounds
  if (!cachedBounds) {
    cachedBounds = { minX: x, maxX: x, minY: y, maxY: y };
  } else {
    if (x < cachedBounds.minX) cachedBounds.minX = x;
    if (x > cachedBounds.maxX) cachedBounds.maxX = x;
    if (y < cachedBounds.minY) cachedBounds.minY = y;
    if (y > cachedBounds.maxY) cachedBounds.maxY = y;
  }
}

/** Get all pixels from cache */
export async function getAllPixels(): Promise<Pixel[]> {
  await ensureLoaded();
  return Array.from(pixelMap!.values());
}

/** Get a single pixel from cache */
export async function getPixel(x: number, y: number): Promise<Pixel | null> {
  await ensureLoaded();
  return pixelMap!.get(key(x, y)) || null;
}

/** Get pixels in a bounding box from cache */
export async function getPixelsInRange(minX: number, maxX: number, minY: number, maxY: number): Promise<Pixel[]> {
  await ensureLoaded();
  const results: Pixel[] = [];
  for (const p of pixelMap!.values()) {
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
      results.push(p);
    }
  }
  return results;
}

/** Get pixel count from cache */
export async function getPixelCount(): Promise<number> {
  await ensureLoaded();
  return pixelMap!.size;
}

/** Get canvas bounds from cache */
export async function getCanvasBounds(): Promise<{ minX: number; maxX: number; minY: number; maxY: number } | null> {
  await ensureLoaded();
  return cachedBounds;
}

/** Get neighborhood of a pixel from cache */
export async function getPixelNeighborhood(x: number, y: number): Promise<{ colors: Record<string, number>; agents: Record<string, number> }> {
  await ensureLoaded();
  const colors: Record<string, number> = {};
  const agents: Record<string, number> = {};

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const p = pixelMap!.get(key(x + dx, y + dy));
      if (p) {
        colors[p.color] = (colors[p.color] || 0) + 1;
        agents[p.agent_id] = (agents[p.agent_id] || 0) + 1;
      }
    }
  }

  return { colors, agents };
}
