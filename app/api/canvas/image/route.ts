import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import crypto from 'crypto';
import { COLOR_PALETTE } from '@/lib/db';
import * as canvasCache from '@/lib/canvas-cache';

// Pre-compute color lookup for speed
const colorToRgb = new Map<string, { r: number; g: number; b: number }>();
for (const hex of COLOR_PALETTE) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  colorToRgb.set(hex.toUpperCase(), { r, g, b });
}

export async function GET(request: NextRequest) {
  try {
    const pixels = await canvasCache.getAllPixels();

    // Generate ETag based on pixel data hash (fast check for changes)
    const pixelHash = crypto.createHash('md5')
      .update(pixels.map(p => `${p.x},${p.y},${p.color}`).join(';'))
      .digest('hex')
      .slice(0, 16);
    const etag = `"${pixelHash}"`;

    // Check If-None-Match header
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { 'ETag': etag }
      });
    }

    // Create RGB buffer (1000x1000x3 = 3MB)
    const buffer = Buffer.alloc(1000 * 1000 * 3);

    // Fill with black by default (buffer is already zeroed)

    // Set each pixel
    for (const pixel of pixels) {
      const { x, y, color } = pixel;
      if (x >= 0 && x < 1000 && y >= 0 && y < 1000) {
        const idx = (y * 1000 + x) * 3;
        const rgb = colorToRgb.get(color.toUpperCase()) || { r: 0, g: 0, b: 0 };
        buffer[idx] = rgb.r;
        buffer[idx + 1] = rgb.g;
        buffer[idx + 2] = rgb.b;
      }
    }

    // Generate PNG (low compression = much faster, minimal size difference)
    const png = await sharp(buffer, {
      raw: { width: 1000, height: 1000, channels: 3 }
    })
      .png({
        palette: true,
        colors: 32,
        compressionLevel: 1,
      })
      .toBuffer();

    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
        'ETag': etag,
        'X-Pixel-Count': String(pixels.length),
      }
    });
  } catch (error) {
    console.error('Error generating canvas image:', error);
    return NextResponse.json(
      { error: 'Failed to generate canvas image' },
      { status: 500 }
    );
  }
}
