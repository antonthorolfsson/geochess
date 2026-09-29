/** Minimal `--key value` / `--flag` parsing for the CLIs. */
export function parseArgs(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const [key, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    if (inline !== undefined) out.set(key, inline);
    else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) out.set(key, argv[++i]!);
    else out.set(key, 'true');
  }
  return out;
}

/** A range like `2-8`, a list like `2,4,8`, or one number. */
export function parseRange(text: string): number[] {
  return text.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number) as [number, number | undefined];
    if (b === undefined || Number.isNaN(b)) return [a];
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}
