import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Realtime channel helpers.
 *
 * supabase-js returns the *same* channel instance for the same topic. Adding
 * `postgres_changes` listeners to a channel that is already subscribed throws
 * ("cannot add postgres_changes callbacks … after subscribe()"), which took the
 * whole app down when two screens listened to e.g. `notifications:<user>` at
 * once (the badge counter and the Notifications screen). Database listeners
 * therefore always get a channel of their own, while broadcast topics that must
 * be shared between people (typing indicators) are reference counted per client.
 */

let sequence = 0;

/** A brand-new channel for database (`postgres_changes`) listeners; the topic is unique per call. */
export function privateChannel(prefix: string): RealtimeChannel {
  sequence += 1;
  return supabase.channel(`${prefix}:${Date.now().toString(36)}-${sequence.toString(36)}`);
}

interface SharedEntry {
  channel: RealtimeChannel;
  refs: number;
  subscribed: boolean;
}

const shared = new Map<string, SharedEntry>();

/**
 * A broadcast channel whose topic is shared by everyone in a conversation.
 * The first caller on this device creates and subscribes it; later callers reuse
 * it (broadcast handlers may be added after subscribing). The channel is removed
 * when the last user releases it.
 */
export function acquireBroadcastChannel(topic: string): { channel: RealtimeChannel; isFirst: boolean; release: () => void } {
  let entry = shared.get(topic);
  const isFirst = !entry;
  if (!entry) {
    entry = { channel: supabase.channel(topic, { config: { broadcast: { self: false } } }), refs: 0, subscribed: false };
    shared.set(topic, entry);
  }
  entry.refs += 1;
  const current = entry;
  return {
    channel: current.channel,
    isFirst,
    release: () => {
      current.refs -= 1;
      if (current.refs > 0) return;
      shared.delete(topic);
      supabase.removeChannel(current.channel).catch(() => undefined);
    },
  };
}

/** Subscribes a shared broadcast channel exactly once. */
export function subscribeShared(topic: string): void {
  const entry = shared.get(topic);
  if (!entry || entry.subscribed) return;
  entry.subscribed = true;
  entry.channel.subscribe();
}
