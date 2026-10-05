// Copies the versioned datasets built by @empire/data into public/ so the browser can fetch
// country data and map shapes as static, cacheable files, and the arsenals and energy table beside
// them (unversioned, so it isn't cached as immutable).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../../packages/data/datasets', import.meta.url));
const target = fileURLToPath(new URL('../public/datasets', import.meta.url));
const facts = fileURLToPath(new URL('../../../packages/data/facts/facts.json', import.meta.url));
const factsTarget = fileURLToPath(new URL('../public/facts', import.meta.url));

if (!existsSync(`${source}/index.json`)) {
  console.warn('No datasets found. Run `pnpm data:build` first.');
  process.exit(0);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true, filter: (path) => !path.endsWith('.md') });
rmSync(factsTarget, { recursive: true, force: true });
if (existsSync(facts)) {
  mkdirSync(factsTarget, { recursive: true });
  cpSync(facts, `${factsTarget}/facts.json`);
}
console.log('Copied datasets to public/datasets');
