// ============================================
// Upload API Route (RESTORED — Task 16)
// ============================================
// POST /api/upload
//
// Handles multipart file uploads for avatars, group avatars, sprites and backgrounds.
//
// Routing rules:
//   - type === 'background' && collection → public/backgrounds/{collection}/{file}
//     (URL: /backgrounds/{collection}/{file}) + the entry is appended to the
//     collection's collection.json so the scanner keeps its metadata.
//   - type === 'sprite' && collection      → public/sprites/{collection}/{file}
//     (URL: /sprites/{collection}/{file}) + metadata.json updated.
//   - anything else                        → public/uploads/{type}/{file}
//     (URL: /uploads/{type}/{file})
//
// Form data:
//   - file: File (required)
//   - type: 'avatar' | 'group-avatar' | 'sprite' | 'background' | 'overlay' (default 'avatar')
//   - collection?: string — target folder (for sprites/backgrounds)
//
// Returns:
//   { success: true, url, filename, originalName, size, type, isAnimation, isVideo }
//   { success: false, error: string }
//
// DELETE /api/upload?url=/backgrounds/X/file.jpg
//   Deletes the file inside public/ (path-traversal protected). If it is a
//   background that lives in a collection, its entry is also removed from
//   collection.json.

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile, unlink } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const BACKGROUNDS_DIR = path.join(PUBLIC_DIR, 'backgrounds');
const SPRITES_DIR = path.join(PUBLIC_DIR, 'sprites');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

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
  'image/avif',
  'video/webm',
  'video/mp4',
  'video/quicktime',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const VIDEO_RE = /\.(webm|mp4|mov|avi|mkv|ogv)$/i;

/** Sanitize a collection/folder name — same rules as /api/backgrounds/collections */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s_-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

/** Generate unique id for collection entries */
function generateEntryId(): string {
  return `bg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function guessExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'video/webm': '.webm',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
  };
  return map[mime] || '.bin';
}

/**
 * Append (or refresh) an entry in {collection}/collection.json after a
 * background upload. Existing entries with the same URL keep their
 * triggerKeys/contextKeys/tags; the entry is only (re)named.
 */
async function updateCollectionJson(collectionPath: string, filename: string, publicUrl: string): Promise<void> {
  const metadataPath = path.join(collectionPath, 'collection.json');

  try {
    let metadata: Record<string, unknown> = {
      name: path.basename(collectionPath),
      version: '1.0',
      transitionDuration: 500,
      entries: [],
    };

    if (existsSync(metadataPath)) {
      const content = await readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(content);
    }

    const entries = (Array.isArray(metadata.entries) ? metadata.entries : []) as Array<Record<string, unknown>>;
    const existingIndex = entries.findIndex((e) => e.url === publicUrl);

    const isVideo = VIDEO_RE.test(filename);
    const name = filename.replace(/\.[^.]+$/, '');

    if (existingIndex >= 0) {
      entries[existingIndex] = {
        ...entries[existingIndex],
        name,
        url: publicUrl,
      };
    } else {
      entries.push({
        id: generateEntryId(),
        name,
        url: publicUrl,
        triggerKeys: [],
        contextKeys: [],
        tags: isVideo ? ['video'] : [],
      });
    }

    metadata.entries = entries;
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`[Upload] Updated collection.json for "${path.basename(collectionPath)}" (+${filename})`);
  } catch (error) {
    console.error('[Upload] Error updating collection.json:', error);
  }
}

/**
 * Append (or refresh) an entry in {collection}/metadata.json after a sprite
 * upload so the sprite appears with proper metadata in the collection.
 */
async function updateSpriteMetadata(collectionPath: string, filename: string): Promise<void> {
  const metadataPath = path.join(collectionPath, 'metadata.json');

  try {
    let metadata: Record<string, unknown> = {
      version: 1,
      collectionName: path.basename(collectionPath),
      sprites: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existsSync(metadataPath)) {
      const content = await readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(content);
    }

    if (!metadata.sprites || typeof metadata.sprites !== 'object') {
      metadata.sprites = {};
    }

    const sprites = metadata.sprites as Record<string, Record<string, unknown>>;

    if (!sprites[filename]) {
      const isVideo = VIDEO_RE.test(filename);
      const label = filename.replace(/\.[^.]+$/, '');
      sprites[filename] = {
        label,
        filename,
        duration: isVideo ? 5000 : 3000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      sprites[filename] = {
        ...sprites[filename],
        updatedAt: new Date().toISOString(),
      };
    }

    metadata.updatedAt = new Date().toISOString();
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`[Upload] Updated metadata.json for sprite collection "${path.basename(collectionPath)}" (+${filename})`);
  } catch (error) {
    console.error('[Upload] Error updating sprite metadata.json:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const type = ((formData.get('type') as string) || 'avatar').trim();
    const rawCollection = ((formData.get('collection') as string) || '').trim();

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'No se proporcionó ningún archivo' },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json(
        {
          success: false,
          error: `Tipo inválido: ${type}. Permitidos: ${Array.from(ALLOWED_TYPES).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `Archivo demasiado grande. Máximo ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME.has(file.type)) {
      console.warn(`[Upload] Unrecognized MIME type: ${file.type} for file ${file.name} (allowed anyway)`);
    }

    // Sanitize the collection folder — prevents path traversal via ../
    const collection = rawCollection ? sanitizeFolderName(rawCollection) : '';
    if (rawCollection && !collection) {
      return NextResponse.json(
        { success: false, error: `Nombre de colección inválido: "${rawCollection}"` },
        { status: 400 }
      );
    }

    // Unique filename: readable base + timestamp + random suffix
    const ext = (path.extname(file.name) || guessExtension(file.type)).toLowerCase();
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const safeBaseName =
      path.basename(file.name, path.extname(file.name))
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .slice(0, 30) || 'upload';
    const filename = `${safeBaseName}-${timestamp}-${randomSuffix}${ext}`;

    // Build target directory + public URL
    let uploadDir: string;
    let publicUrl: string;

    if (type === 'background' && collection) {
      uploadDir = path.join(BACKGROUNDS_DIR, collection);
      publicUrl = `/backgrounds/${collection}/${filename}`;
    } else if (type === 'sprite' && collection) {
      uploadDir = path.join(SPRITES_DIR, collection);
      publicUrl = `/sprites/${collection}/${filename}`;
    } else {
      uploadDir = path.join(UPLOADS_DIR, type);
      publicUrl = `/uploads/${type}/${filename}`;
    }

    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Keep metadata files in sync
    if (type === 'background' && collection) {
      await updateCollectionJson(uploadDir, filename, publicUrl);
    } else if (type === 'sprite' && collection) {
      await updateSpriteMetadata(uploadDir, filename);
    }

    const isVideo = VIDEO_RE.test(filename);
    const isAnimation = /\.(gif|webm|mp4|mov|apng)$/i.test(filename);

    console.log(`[Upload] Saved ${file.name} (${file.size} bytes) → ${publicUrl}`);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      filename,
      originalName: file.name,
      size: file.size,
      type,
      collection: collection || undefined,
      isAnimation,
      isVideo,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error al subir el archivo' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url || !url.startsWith('/') || url.includes('..')) {
      return NextResponse.json({ success: false, error: 'URL inválida' }, { status: 400 });
    }

    const filePath = path.join(PUBLIC_DIR, url);
    const resolved = path.resolve(filePath);

    // Path-traversal guard: must stay inside public/
    if (!resolved.startsWith(PUBLIC_DIR + path.sep)) {
      return NextResponse.json({ success: false, error: 'URL fuera del directorio público' }, { status: 400 });
    }

    if (existsSync(resolved)) {
      await unlink(resolved);
    } else {
      return NextResponse.json({ success: false, error: 'Archivo no encontrado' }, { status: 404 });
    }

    // If it's a background inside a collection, remove its entry from collection.json
    const bgMatch = url.match(/^\/backgrounds\/([^/]+)\/([^/]+)$/);
    if (bgMatch) {
      const [, folder, filename] = bgMatch;
      const metadataPath = path.join(BACKGROUNDS_DIR, folder, 'collection.json');
      if (existsSync(metadataPath)) {
        try {
          const content = await readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(content);
          if (Array.isArray(metadata.entries)) {
            const fileUrl = `/backgrounds/${folder}/${filename}`;
            metadata.entries = metadata.entries.filter(
              (e: { url?: string }) => e.url !== fileUrl
            );
            await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
          }
        } catch (e) {
          console.error('[Upload] Error cleaning collection.json entry:', e);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Upload] Delete error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error al eliminar el archivo' },
      { status: 500 }
    );
  }
}
