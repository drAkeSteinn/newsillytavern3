// ============================================
// Uploads List API Route
// ============================================
// GET /api/uploads/list?type=avatar
// GET /api/uploads/list?type=sprite&collection=Ximena
//
// Lists files in public/uploads/{type}/[{collection}/] so the UI can show
// a "pick from library" picker for avatars/sprites/backgrounds.
//
// Returns:
//   { success: true, files: [{ url, filename, size, mtime }] }

import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

const ALLOWED_TYPES = new Set([
  'avatar',
  'group-avatar',
  'sprite',
  'background',
  'overlay',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.webm', '.mp4']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg']);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'avatar';
    const collection = searchParams.get('collection');

    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json(
        { success: false, error: `Invalid type: ${type}` },
        { status: 400 }
      );
    }

    const uploadsBase = path.join(process.cwd(), 'public', 'uploads', type);
    const targetDir = collection
      ? path.join(uploadsBase, collection)
      : uploadsBase;

    if (!existsSync(targetDir)) {
      return NextResponse.json({ success: true, files: [] });
    }

    const entries = await readdir(targetDir, { withFileTypes: true });
    const files: Array<{
      url: string;
      filename: string;
      size: number;
      mtime: string;
      mediaType: 'image' | 'video' | 'audio' | 'other';
    }> = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext) && !AUDIO_EXTENSIONS.has(ext)) {
        continue;
      }

      const fullPath = path.join(targetDir, entry.name);
      const stats = await stat(fullPath);

      const urlPath = collection
        ? `/uploads/${type}/${collection}/${entry.name}`
        : `/uploads/${type}/${entry.name}`;

      let mediaType: 'image' | 'video' | 'audio' | 'other' = 'other';
      if (IMAGE_EXTENSIONS.has(ext)) mediaType = 'image';
      else if (VIDEO_EXTENSIONS.has(ext)) mediaType = 'video';
      else if (AUDIO_EXTENSIONS.has(ext)) mediaType = 'audio';

      files.push({
        url: urlPath,
        filename: entry.name,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        mediaType,
      });
    }

    // Sort by modification time descending (newest first)
    files.sort((a, b) => b.mtime.localeCompare(a.mtime));

    return NextResponse.json({ success: true, files });
  } catch (error) {
    console.error('[Uploads List] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to list files' },
      { status: 500 }
    );
  }
}
