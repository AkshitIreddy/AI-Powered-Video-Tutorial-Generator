import { useCallback, useEffect, useState } from "react";

export function usePersistentState<T>(key: string, initial: T, normalize: (value: T) => T = (value) => value) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return normalize(stored ? (JSON.parse(stored) as T) : initial);
    } catch {
      return normalize(initial);
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The UI stays usable if storage is disabled or full.
    }
  }, [key, value]);

  const reset = useCallback(() => setValue(normalize(initial)), [initial, normalize]);
  return [value, setValue, reset] as const;
}
