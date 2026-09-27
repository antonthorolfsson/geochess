// Copies the versioned datasets built by @empire/data into public/ so the browser can fetch
// country data and map shapes as static, cacheable files.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../../packages/data/datasets', import.meta.url));
const target = fileURLToPath(new URL('../public/datasets', import.meta.url));

if (!existsSync(`${source}/index.json`)) {
  console.warn('No datasets found. Run `pnpm data:build` first.');
  process.exit(0);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true, filter: (path) => !path.endsWith('.md') });
console.log('Copied datasets to public/datasets');
