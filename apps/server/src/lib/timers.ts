/**
 * One-shot timers by key, such as a live game's flag, replaced when re-armed. Tests turn them
 * off and drive deadlines by hand.
 */
export class Timers {
  readonly enabled: boolean;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Runs `fn` at `at` (epoch milliseconds), replacing any timer with the same key. */
  set(key: string, at: number, fn: () => void): void {
    if (!this.enabled) return;
    this.clear(key);
    const timer = setTimeout(
      () => {
        this.timers.delete(key);
        fn();
      },
      Math.max(0, at - Date.now()),
    );
    this.timers.set(key, timer);
  }

  clear(key: string): void {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  clearAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
