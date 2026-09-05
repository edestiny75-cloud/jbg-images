'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * Multi-select over a list. Replaces three parallel toggle/selectAll/clear
 * triples that each worked on a different state shape — `printSel` (a Set),
 * `exportSel` (an object used two different ways) and `wholeSel` (an array).
 */
export function useSelection<T>(keyFn: (item: T) => string) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((item: T) => {
    const k = keyFn(item);
    setKeys((prev) => {
      const next = new Set(prev);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  }, [keyFn]);

  const set = useCallback((item: T, selected: boolean) => {
    const k = keyFn(item);
    setKeys((prev) => {
      if (prev.has(k) === selected) return prev;
      const next = new Set(prev);
      if (selected) next.add(k);
      else next.delete(k);
      return next;
    });
  }, [keyFn]);

  /** Selects exactly what is currently visible, which is what "select all" means on a filtered list. */
  const selectAll = useCallback((items: readonly T[]) => {
    setKeys(new Set(items.map(keyFn)));
  }, [keyFn]);

  const clear = useCallback(() => setKeys(new Set()), []);

  const isSelected = useCallback((item: T) => keys.has(keyFn(item)), [keys, keyFn]);

  return useMemo(
    () => ({ keys, count: keys.size, isSelected, toggle, set, selectAll, clear }),
    [keys, isSelected, toggle, set, selectAll, clear],
  );
}
