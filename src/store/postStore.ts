import { create } from 'zustand';

import type { PostCard } from '@/types/social';

interface PostState {
  byId: Record<string, PostCard>;
  upsert: (posts: PostCard | PostCard[]) => void;
  patch: (id: string, patch: Partial<PostCard> | ((prev: PostCard) => PostCard)) => void;
  remove: (id: string) => void;
}

/**
 * Normalised cache of post cards so that a like in the feed, the post detail
 * screen and a profile grid all stay in sync without refetching.
 */
export const usePostStore = create<PostState>((set) => ({
  byId: {},
  upsert: (posts) =>
    set((state) => {
      const list = Array.isArray(posts) ? posts : [posts];
      if (list.length === 0) return state;
      const next = { ...state.byId };
      for (const post of list) next[post.id] = post;
      return { byId: next };
    }),
  patch: (id, patch) =>
    set((state) => {
      const prev = state.byId[id];
      if (!prev) return state;
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      return { byId: { ...state.byId, [id]: next } };
    }),
  remove: (id) =>
    set((state) => {
      if (!state.byId[id]) return state;
      const next = { ...state.byId };
      delete next[id];
      return { byId: next };
    }),
}));

export function usePost(id: string): PostCard | undefined {
  return usePostStore((s) => s.byId[id]);
}
