// Renders the emblem and app icons in public/icons from the logo in media/geochess_logo.png.
// Run with `pnpm --filter @empire/web icons`.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const logo = fileURLToPath(new URL('../../../media/geochess_logo.png', import.meta.url));
const dir = new URL('../public/icons/', import.meta.url);
const background = '#1f2428';
const clear = { r: 0, g: 0, b: 0, alpha: 0 };

// The logo is the globe-and-rook emblem above the wordmark, on transparency. The emblem is the
// first band of rows with opaque pixels. Faint leftovers of the artwork's glow are cleared.
const { data, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) if (data[i + 3] <= 8) data.fill(0, i, i + 4);
let top = -1;
let bottom = -1;
let left = info.width;
let right = -1;
for (let y = 0; y < info.height; y++) {
  let opaque = false;
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 128) continue;
    opaque = true;
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  if (opaque) {
    if (top < 0) top = y;
    bottom = y;
  } else if (top >= 0) break;
}
const pad = 4; // keeps the anti-aliased edge
const emblem = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .extract({
    left: left - pad,
    top: top - pad,
    width: right - left + 1 + pad * 2,
    height: bottom - top + 1 + pad * 2,
  })
  .png()
  .toBuffer();

async function render(size, file, { inset = 0, fill = clear, disc = false } = {}) {
  const inner = Math.round(size * (1 - inset * 2));
  const icon = await sharp(emblem).resize(inner, inner, { fit: 'contain', background: clear }).png().toBuffer();
  const layers = [{ input: icon, gravity: 'center' }];
  // A page-colored disc behind the cut-outs, just inside the emblem's rim.
  if (disc) {
    const r = inner * 0.475;
    const circle = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${background}"/></svg>`;
    layers.unshift({ input: Buffer.from(circle) });
  }
  await sharp({ create: { width: size, height: size, channels: 4, background: fill } })
    .composite(layers)
    // Two colors and their edges: 16 is plenty, and a third of the size.
    .png({ palette: true, colours: 16, dither: 0, compressionLevel: 9, effort: 10 })
    .toFile(fileURLToPath(new URL(file, dir)));
  console.log(`wrote ${file}`);
}

// On transparency: the app header and landing page, and notification badges (Android draws those
// from the alpha channel alone).
await render(256, 'emblem.png');
// The browser tab, looking the same on light and dark tab strips.
await render(64, 'favicon.png', { disc: true });
// Home screen and install icons are opaque, on the page background.
await render(192, 'icon-192.png', { inset: 0.14, fill: background });
await render(512, 'icon-512.png', { inset: 0.14, fill: background });
await render(180, 'apple-touch-icon.png', { inset: 0.14, fill: background });
// Maskable icons are cropped to a circle or squircle by the OS; keep the emblem well inside the
// safe zone (the middle 80%).
await render(512, 'icon-maskable-512.png', { inset: 0.2, fill: background });
