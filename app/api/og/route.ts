import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { COLOR_PALETTE } from '@/lib/db';
import * as canvasCache from '@/lib/canvas-cache';

// Pre-compute color lookup
const colorToRgb = new Map<string, { r: number; g: number; b: number }>();
for (const hex of COLOR_PALETTE) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  colorToRgb.set(hex.toUpperCase(), { r, g, b });
}

export async function GET() {
  try {
    const pixels = await canvasCache.getAllPixels();

    // Create 1000x1000 canvas
    const canvasSize = 1000;
    const buffer = Buffer.alloc(canvasSize * canvasSize * 3);

    // Fill pixels
    for (const pixel of pixels) {
      const { x, y, color } = pixel;
      if (x >= 0 && x < canvasSize && y >= 0 && y < canvasSize) {
        const idx = (y * canvasSize + x) * 3;
        const rgb = colorToRgb.get(color.toUpperCase()) || { r: 0, g: 0, b: 0 };
        buffer[idx] = rgb.r;
        buffer[idx + 1] = rgb.g;
        buffer[idx + 2] = rgb.b;
      }
    }

    // OG image dimensions
    const ogWidth = 1200;
    const ogHeight = 630;
    const canvasDisplaySize = 500;

    // Create the canvas image (resized)
    const canvasImage = await sharp(buffer, {
      raw: { width: canvasSize, height: canvasSize, channels: 3 }
    })
      .resize(canvasDisplaySize, canvasDisplaySize, { fit: 'contain' })
      .png()
      .toBuffer();

    // Create OG image with dark background and centered canvas
    const ogImage = await sharp({
      create: {
        width: ogWidth,
        height: ogHeight,
        channels: 3,
        background: { r: 10, g: 10, b: 10 }
      }
    })
      .composite([
        {
          input: canvasImage,
          left: Math.floor((ogWidth - canvasDisplaySize) / 2),
          top: Math.floor((ogHeight - canvasDisplaySize) / 2)
        }
      ])
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(ogImage), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200',
      }
    });
  } catch (error) {
    console.error('OG image generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate OG image' },
      { status: 500 }
    );
  }
}
