/**
 * Only same-site relative paths are allowed as post-sign-in destinations. Without one, signing in
 * leads to the player's campaigns.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/campaigns';
  }
  return next;
}
