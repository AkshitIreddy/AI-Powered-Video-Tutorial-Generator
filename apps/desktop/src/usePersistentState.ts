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
      const serialized = JSON.stringify(value);
      if (localStorage.getItem(key) !== serialized) {
        localStorage.setItem(key, serialized);
        window.dispatchEvent(new CustomEvent("workspace-preference-changed", { detail: { key, serialized } }));
      }
    } catch {
      // The UI stays usable if storage is disabled or full.
    }
  }, [key, value]);

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; serialized: string }>).detail;
      if (detail?.key !== key) return;
      try {
        setValue((current) => JSON.stringify(current) === detail.serialized ? current : JSON.parse(detail.serialized) as T);
      } catch { /* Ignore malformed values from other surfaces. */ }
    };
    window.addEventListener("workspace-preference-changed", changed);
    return () => window.removeEventListener("workspace-preference-changed", changed);
  }, [key]);

  const reset = useCallback(() => setValue(normalize(initial)), [initial, normalize]);
  return [value, setValue, reset] as const;
}
