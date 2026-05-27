// Upscale 8 Ideogram outputs (1312x736) → 1920x1080 with Sharp lanczos3, save as JPEG q92.
import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = '/tmp/ps-walkthrough';
const DST = '/Users/Apple/emdash/repositories/projectsites.dev/apps/project-sites/public/walkthrough';

const files = (await readdir(SRC)).filter((f) => f.endsWith('.png')).sort();
console.log(`Processing ${files.length} images → ${DST}`);

const results = await Promise.all(
  files.map(async (name) => {
    const src = join(SRC, name);
    const dst = join(DST, name.replace('.png', '.jpg'));
    const meta = await sharp(src).metadata();
    const info = await sharp(src)
      .resize(1920, 1080, { kernel: sharp.kernel.lanczos3, fit: 'cover', position: 'center' })
      .jpeg({ quality: 92, mozjpeg: true, progressive: true })
      .toFile(dst);
    return { name, in: `${meta.width}x${meta.height}`, out: `${info.width}x${info.height}`, bytes: info.size };
  }),
);

console.table(results);
