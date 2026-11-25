/**
 * Pure helpers for LiveKit webhook events. No Deno, Node or React imports so the
 * `livekit-webhook` Edge Function and the Jest test-suite share the same logic.
 */

export const HANDLED_EVENTS = ['room_started', 'room_finished', 'participant_joined', 'participant_left', 'egress_started', 'egress_updated', 'egress_ended'] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];
export type RoomScope = 'live' | 'call' | 'other';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Friendzy room names are `live_<uuid>` (livestreams) and `call_<uuid>` (calls). */
export function parseRoomName(name: string | null | undefined): { scope: RoomScope; id: string | null } {
  if (!name) return { scope: 'other', id: null };
  const match = /^(live|call)_(.+)$/.exec(name);
  if (!match || !UUID.test(match[2])) return { scope: 'other', id: null };
  return { scope: match[1] as 'live' | 'call', id: match[2].toLowerCase() };
}

/** Structural subset of the SDK's WebhookEvent (protobuf message) that we read. */
export interface LiveKitEventLike {
  id?: string;
  event?: string;
  createdAt?: bigint | number | string;
  numDropped?: number;
  room?: { sid?: string; name?: string } | null;
  participant?: { sid?: string; identity?: string } | null;
  egressInfo?: { egressId?: string; roomName?: string; roomId?: string } | null;
  /** protobuf-es message → plain JSON (int64 as strings). */
  toJson?: () => unknown;
}

export interface EventRecord {
  id: string;
  event: string;
  roomName: string | null;
  roomSid: string | null;
  participantIdentity: string | null;
  participantSid: string | null;
  egressId: string | null;
  /** ISO timestamp reported by LiveKit (createdAt, seconds since epoch). */
  eventAt: string | null;
  numDropped: number;
  scope: RoomScope;
  targetId: string | null;
  /** Full event as plain JSON (int64 fields rendered as strings). */
  payload: unknown;
}

function toNumber(value: bigint | number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Unix seconds → ISO string (LiveKit `createdAt`, `joinedAt`, `creationTime`). */
export function secondsToIso(value: bigint | number | string | null | undefined): string | null {
  const n = toNumber(value);
  if (!n || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** Unix nanoseconds → ISO string (LiveKit egress `startedAt` / `endedAt`). */
export function nanosToIso(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const nanos = typeof value === 'bigint' ? value : BigInt(String(value).replace(/\..*$/, ''));
    if (nanos <= 0n) return null;
    return new Date(Number(nanos / 1_000_000n)).toISOString();
  } catch {
    return null;
  }
}

/** JSON-safe copy of the event (uses the protobuf `toJson` when available). */
export function toPlainJson(event: LiveKitEventLike): unknown {
  if (typeof event.toJson === 'function') {
    try {
      return event.toJson();
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(event, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)));
}

function clean(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v.length > 0 ? v : null;
}

/** Normalises a verified event into the row the database RPC expects. Returns null when the event has no id or type. */
export function summarizeEvent(event: LiveKitEventLike): EventRecord | null {
  const id = clean(event.id);
  const type = clean(event.event);
  if (!id || !type) return null;
  const roomName = clean(event.room?.name) ?? clean(event.egressInfo?.roomName);
  const { scope, id: targetId } = parseRoomName(roomName);
  return {
    id,
    event: type,
    roomName,
    roomSid: clean(event.room?.sid) ?? clean(event.egressInfo?.roomId),
    participantIdentity: clean(event.participant?.identity),
    participantSid: clean(event.participant?.sid),
    egressId: clean(event.egressInfo?.egressId),
    eventAt: secondsToIso(event.createdAt),
    numDropped: Math.max(0, toNumber(event.numDropped) ?? 0),
    scope,
    targetId,
    payload: toPlainJson(event),
  };
}

export function isHandledEvent(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}
