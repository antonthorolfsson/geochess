// Renders the app icons in public/icons from icon.svg. Run with `pnpm --filter @empire/web icons`.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const dir = new URL('../public/icons/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir));
const background = '#1f2428';

async function render(size, file, { padding = 0 } = {}) {
  const inner = Math.round(size * (1 - padding * 2));
  const icon = await sharp(svg, { density: 1200 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(new URL(file, dir).pathname);
  console.log(`wrote ${file}`);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
// Maskable icons are cropped to a circle or squircle by the OS; keep the emblem in the safe zone.
await render(512, 'icon-maskable-512.png', { padding: 0.12 });
await render(180, 'apple-touch-icon.png');
