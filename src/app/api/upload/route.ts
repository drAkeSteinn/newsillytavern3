// ============================================
// Upload API Route
// ============================================
// POST /api/upload
//
// Handles multipart file uploads for avatars, group avatars, sprites, and backgrounds.
// Files are saved to public/uploads/{type}/ with a unique timestamped name.
//
// Form data:
//   - file: File (required) — the image file
//   - type: string — 'avatar' | 'group-avatar' | 'sprite' | 'background' (default: 'avatar')
//   - collection?: string — subfolder name (for sprites/backgrounds, e.g. character name)
//
// Returns:
//   { success: true, url: "/uploads/{type}/{filename}" }
//   { success: false, error: string }

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_TYPES = new Set([
  'avatar',
  'group-avatar',
  'sprite',
  'background',
  'overlay',
]);

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
  'video/webm',
  'video/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const type = (formData.get('type') as string) || 'avatar';
    const collection = formData.get('collection') as string | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json(
        { success: false, error: `Invalid type: ${type}. Allowed: ${Array.from(ALLOWED_TYPES).join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Validate MIME type (allow unknown types for flexibility, but log)
    if (!ALLOWED_MIME.has(file.type)) {
      console.warn(`[Upload] Unrecognized MIME type: ${file.type} for file ${file.name}`);
      // Still allow — some browsers report differently for webm/mp4
    }

    // Build the target directory: public/uploads/{type}/[{collection}/]
    const uploadsBase = path.join(process.cwd(), 'public', 'uploads', type);
    const targetDir = collection
      ? path.join(uploadsBase, collection)
      : uploadsBase;

    // Ensure directory exists
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    // Generate a unique filename with timestamp + random suffix
    const ext = path.extname(file.name) || guessExtension(file.type);
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const safeBaseName = path.basename(file.name, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '')
      .slice(0, 20) || 'upload';
    const filename = `${timestamp}-${randomSuffix}${ext}`;

    const filePath = path.join(targetDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Build the public URL
    const urlPath = collection
      ? `/uploads/${type}/${collection}/${filename}`
      : `/uploads/${type}/${filename}`;

    console.log(`[Upload] Saved ${file.name} (${file.size} bytes) → ${urlPath}`);

    return NextResponse.json({
      success: true,
      url: urlPath,
      filename,
      size: file.size,
      type,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

/** Guess file extension from MIME type */
function guessExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'video/webm': '.webm',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
  };
  return map[mime] || '.bin';
}
