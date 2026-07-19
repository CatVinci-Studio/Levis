/** Minimal in-memory Storage for jsdom runs where Node exposes an unusable
 * experimental localStorage global. Application code still uses the real
 * Web Storage implementation. */
export function installTestLocalStorage(): Storage {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}
