// ============================================
// Embeddings File Upload API Route
// ============================================
// POST /api/embeddings/upload
//
// Handles multipart file uploads for the Knowledge/Conocimiento system.
// Reads the file content as text and returns it for chunking + embedding.
//
// This is DIFFERENT from /api/upload (which saves image/avatar files to disk).
// This route reads text content from documents (.txt, .md, .json, .csv, etc.)
// and returns the content so the client can preview chunks and then call
// /api/embeddings/create-from-file to embed them into LanceDB.
//
// Form data:
//   - file: File (required) — the text document to read
//
// Returns:
//   { success: true, data: { fileName, fileSize, content, characterCount } }
//   { success: false, error: string }

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.rtf', '.text',
]);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
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

    // Check file extension
    const fileName = file.name.toLowerCase();
    const ext = fileName.substring(fileName.lastIndexOf('.'));
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file type: ${ext}. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Read file content as text
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Try to decode as UTF-8 text
    let content: string;
    try {
      content = buffer.toString('utf-8');
    } catch {
      return NextResponse.json(
        { success: false, error: 'Failed to decode file as UTF-8 text. Ensure the file is a text document.' },
        { status: 400 }
      );
    }

    // Validate content is not empty
    if (!content.trim()) {
      return NextResponse.json(
        { success: false, error: 'File is empty or contains no readable text.' },
        { status: 400 }
      );
    }

    const characterCount = content.length;

    console.log(`[Embeddings Upload] File "${file.name}" loaded: ${file.size} bytes, ${characterCount} chars`);

    return NextResponse.json({
      success: true,
      data: {
        fileName: file.name,
        fileSize: file.size,
        content,
        characterCount,
      },
    });
  } catch (error) {
    console.error('[Embeddings Upload] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      },
      { status: 500 }
    );
  }
}
