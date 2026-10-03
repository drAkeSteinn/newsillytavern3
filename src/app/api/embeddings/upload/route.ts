import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/embeddings/upload - Upload a text file for knowledge/embeddings
 *
 * Accepts multipart/form-data with a "file" field.
 * Reads the file as UTF-8 text and returns its content so the client can
 * preview it and POST it to /api/embeddings/create-from-file afterwards.
 *
 * Response: { success: true, data: { fileName, fileSize, content, characterCount } }
 */

export const runtime = 'nodejs';

// Allowed text-based extensions for knowledge files
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log',
  '.xml', '.yaml', '.yml', '.html', '.htm', '.rtf', '.text',
]);

// 10 MB hard limit for knowledge files (they get chunked + embedded)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx).toLowerCase();
}

/**
 * Best-effort cleanup of binary artifacts so broken encodings don't
 * poison the splitter/embedding pipeline.
 */
function sanitizeText(input: string): string {
  return input
    .replace(/\u0000/g, '')          // null bytes (binary contamination)
    .replace(/\uFFFD/g, '');         // replacement chars from bad UTF-8
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { success: false, error: 'No se recibió ningún archivo válido (campo "file").' },
        { status: 400 }
      );
    }

    const fileName = file.name || 'archivo';
    const ext = getFileExtension(fileName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: `Extensión no permitida: "${ext || '(sin extensión)'}". Formatos aceptados: txt, md, json, csv, xml, yaml, html, rtf, log.`,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el límite es 10 MB. Divídelo en archivos más pequeños.`,
        },
        { status: 400 }
      );
    }

    const raw = await file.text();
    const content = sanitizeText(raw);

    if (!content.trim()) {
      return NextResponse.json(
        { success: false, error: 'El archivo no contiene texto legible (¿está vacío o es binario?).' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        fileName,
        fileSize: file.size,
        content,
        characterCount: content.length,
      },
    });
  } catch (error: any) {
    console.error('[Embeddings Upload] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error al procesar el archivo.' },
      { status: 500 }
    );
  }
}
