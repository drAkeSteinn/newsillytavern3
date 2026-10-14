import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = './public/icons/ahegao-icon-raw.png';
const OUT_DIR = './public/icons';
const APP_DIR = './src/app';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192.png', size: 192 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-48.png', size: 48 },
  { file: 'favicon-32.png', size: 32 },
  { file: 'favicon-16.png', size: 16 },
];

for (const t of targets) {
  await sharp(SRC)
    .resize(t.size, t.size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, t.file));
  console.log(`✓ ${t.file} (${t.size}x${t.size})`);
}

// App icon used at chat header / general purpose
await sharp(SRC).resize(256, 256, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile('./public/icons/icon-256.png');
console.log('✓ icon-256.png (256x256)');

// favicon: 64x64 png in src/app convention (Next auto-link)
await sharp(SRC).resize(64, 64, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(path.join(APP_DIR, 'icon.png'));
console.log('✓ src/app/icon.png (64x64, Next.js favicon convention)');

console.log('All icons generated.');
