import { useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage } from '@/utils/errors';

export interface Page<T, C> {
  items: T[];
  nextCursor: C | null;
}

export interface PagedQuery<T> {
  items: T[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  setItems: (updater: (items: T[]) => T[]) => void;
  prepend: (item: T) => void;
  removeWhere: (predicate: (item: T) => boolean) => void;
}

/**
 * Cursor-based pagination with de-duplication, pull-to-refresh and
 * stale-response protection. `key` restarts the query when it changes.
 */
export function usePagedQuery<T, C = string | number>(
  fetchPage: (cursor: C | null) => Promise<Page<T, C>>,
  getId: (item: T) => string,
  key: string,
  options: { enabled?: boolean } = {},
): PagedQuery<T> {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<{ key: string; items: T[]; cursor: C | null; hasMore: boolean; loaded: boolean; error: string | null }>({
    key,
    items: [],
    cursor: null,
    hasMore: true,
    loaded: false,
    error: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  const current = state.key === key ? state : null;

  const run = useCallback(
    async (mode: 'initial' | 'refresh' | 'more', cursor: C | null) => {
      const id = ++requestId.current;
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'more') setLoadingMore(true);
      try {
        const page = await fetchRef.current(cursor);
        if (id !== requestId.current) return;
        setState((prev) => {
          const base = mode === 'more' && prev.key === key ? prev.items : [];
          const seen = new Set(base.map(getId));
          const merged = [...base, ...page.items.filter((item) => !seen.has(getId(item)))];
          return { key, items: merged, cursor: page.nextCursor, hasMore: page.nextCursor !== null && page.items.length > 0, loaded: true, error: null };
        });
      } catch (error) {
        if (id !== requestId.current) return;
        setState((prev) => ({
          key,
          items: prev.key === key ? prev.items : [],
          cursor: prev.key === key ? prev.cursor : null,
          hasMore: prev.key === key ? prev.hasMore : true,
          loaded: true,
          error: getErrorMessage(error),
        }));
      } finally {
        if (id === requestId.current) {
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [key, getId],
  );

  useEffect(() => {
    if (!enabled) return;
    void run('initial', null);
  }, [enabled, key, run]);

  const loadMore = useCallback(async () => {
    if (!current || !current.loaded || !current.hasMore || loadingMore || refreshing) return;
    await run('more', current.cursor);
  }, [current, loadingMore, refreshing, run]);

  const refresh = useCallback(() => run('refresh', null), [run]);

  const setItems = useCallback(
    (updater: (items: T[]) => T[]) => setState((prev) => (prev.key === key ? { ...prev, items: updater(prev.items) } : prev)),
    [key],
  );

  return {
    items: current?.items ?? [],
    loading: enabled && !(current?.loaded ?? false),
    refreshing,
    loadingMore,
    error: current?.error ?? null,
    hasMore: current?.hasMore ?? true,
    refresh,
    loadMore,
    setItems,
    prepend: (item) => setItems((items) => [item, ...items.filter((i) => getId(i) !== getId(item))]),
    removeWhere: (predicate) => setItems((items) => items.filter((i) => !predicate(i))),
  };
}
