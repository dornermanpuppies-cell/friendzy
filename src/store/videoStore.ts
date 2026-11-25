import { create } from 'zustand';

import type { VideoCard } from '@/types/video';

interface VideoState {
  byId: Record<string, VideoCard>;
  removed: Record<string, true>;
  muted: boolean;
  upsert: (videos: VideoCard[]) => void;
  patch: (id: string, patch: Partial<VideoCard>) => void;
  remove: (id: string) => void;
  setMuted: (muted: boolean) => void;
}

/** Shared cache so like/save state stays consistent across feed, grid and detail. */
export const useVideoStore = create<VideoState>((set) => ({
  byId: {},
  removed: {},
  muted: false,
  upsert: (videos) =>
    set((state) => {
      const byId = { ...state.byId };
      for (const v of videos) byId[v.id] = v;
      return { byId };
    }),
  patch: (id, patch) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      return { byId: { ...state.byId, [id]: { ...current, ...patch } } };
    }),
  remove: (id) => set((state) => ({ removed: { ...state.removed, [id]: true } })),
  setMuted: (muted) => set({ muted }),
}));

export function useVideo(id: string): VideoCard | undefined {
  return useVideoStore((s) => s.byId[id]);
}
