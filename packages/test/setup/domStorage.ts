import "@testing-library/jest-dom/vitest";

/**
 * Give DOM suites a working `localStorage`.
 *
 * Node 25 ships its own `localStorage` global, and without `--localstorage-file`
 * it is an object with no methods at all — `localStorage.clear` is `undefined`.
 * It is defined on the runtime's globalThis before any test environment loads,
 * so it wins over the one jsdom provides: `window.localStorage === globalThis.
 * localStorage`, and both are the broken one. jsdom's own Storage is fine in
 * isolation, which is what makes this so confusing to diagnose.
 *
 * Rather than depend on a Node flag, install a real in-memory Storage. It is
 * also simply better for tests: no cross-file leakage, and spying on
 * `Storage.prototype` behaves the way the browser one does.
 */
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

if (typeof window !== "undefined") {
  const storage = new MemoryStorage();
  for (const target of [globalThis, window] as const) {
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(target, "Storage", {
      value: MemoryStorage,
      configurable: true,
      writable: true,
    });
  }
}
