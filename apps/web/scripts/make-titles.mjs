// Renders the title tokens in public/titles from the art in media/titles: each trimmed to its coin
// and made 128 pixels square (shown at 16 to 40). Run with `pnpm --filter @empire/web titles`.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const KINDS = ['population', 'land', 'economy', 'military'];
const dir = fileURLToPath(new URL('../public/titles/', import.meta.url));
await mkdir(dir, { recursive: true });
for (const kind of KINDS) {
  const art = fileURLToPath(new URL(`../../../media/titles/${kind}.webp`, import.meta.url));
  const trimmed = await sharp(art).trim({ threshold: 8 }).toBuffer();
  await sharp(trimmed)
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88, alphaQuality: 100 })
    .toFile(`${dir}${kind}.webp`);
  console.log(`public/titles/${kind}.webp`);
}
