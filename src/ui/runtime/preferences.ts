/** Keeps existing keys and Storage semantics, including quota failures. */
export type PreferenceStore = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

export function createMemoryPreferences(): PreferenceStore {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(String(key));
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
}
