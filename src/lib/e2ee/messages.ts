/**
 * Message-level sealing/opening: turns chat content into envelopes and back.
 * Plaintext only ever exists in memory on the user's devices.
 */
import { useAuthStore } from '@/store/authStore';
import type { Message, MessageAttachment, MessageKind, MessageMetadata } from '@/types/messaging';
import { AppError } from '@/utils/errors';

import { decodePayload, encodePayload, openEnvelope, sealEnvelope, type Envelope } from './crypto';
import { ensureLocalDevice, findSenderDevice, getLocalDevice, getRecipients, type E2eeDeviceInfo, type RecipientSet } from './devices';
import { fromBase64 } from './bytes';

/** Per-attachment secrets travel inside the envelope, never in the database row. */
export interface AttachmentSecret {
  name: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  waveform: number[] | null;
  /** Plaintext size (the row stores the ciphertext size). */
  size_bytes: number | null;
  key: string;
  nonce: string;
  thumb: { key: string; nonce: string } | null;
}

export interface EnvelopePayloadV1 {
  text: string | null;
  metadata: MessageMetadata;
  attachments: AttachmentSecret[];
}

export type DecryptError = 'NO_DEVICE' | 'NO_KEY_FOR_DEVICE' | 'BAD_SIGNATURE' | 'CORRUPT' | 'UNSUPPORTED';

export interface DecryptedParts {
  text: string | null;
  metadata: MessageMetadata;
  attachments: AttachmentSecret[];
  verified: boolean;
}

type CacheEntry = { ok: true; parts: DecryptedParts } | { ok: false; error: DecryptError };
const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 3000;

function remember(key: string, entry: CacheEntry): CacheEntry {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, entry);
  return entry;
}

export function clearDecryptCache(): void {
  cache.clear();
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ----------------------------------------------------------------------------
// Sealing
// ----------------------------------------------------------------------------
export async function sealForDevices(params: { conversationId: string; kind: MessageKind; payload: EnvelopePayloadV1; userId: string; devices: E2eeDeviceInfo[] }): Promise<Envelope> {
  const device = await ensureLocalDevice(params.userId);
  const recipients = params.devices.filter((d) => !d.revoked_at);
  if (!recipients.some((d) => d.device_id === device.deviceId)) {
    recipients.push({ user_id: device.userId, device_id: device.deviceId, platform: 'web', name: null, identity_key: device.identityKey, signing_key: device.signingKey, created_at: device.createdAt, last_seen_at: null, revoked_at: null });
  }
  return sealEnvelope({
    payload: encodePayload(params.payload),
    context: { conversationId: params.conversationId, kind: params.kind },
    sender: { userId: params.userId, deviceId: device.deviceId, keys: device.keys },
    recipients,
  });
}

export async function sealForConversation(params: { conversationId: string; kind: MessageKind; payload: EnvelopePayloadV1; userId: string; force?: boolean }): Promise<{ envelope: Envelope; recipients: RecipientSet }> {
  const recipients = await getRecipients(params.conversationId, { force: params.force });
  if (recipients.missing.length > 0) {
    throw new AppError('This chat is end-to-end encrypted. The other person needs to open Friendzy once before you can message them.', 'RECIPIENT_WITHOUT_KEYS');
  }
  const envelope = await sealForDevices({ ...params, devices: recipients.devices });
  return { envelope, recipients };
}

// ----------------------------------------------------------------------------
// Opening
// ----------------------------------------------------------------------------
function isPayload(value: unknown): value is EnvelopePayloadV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.text === null || typeof v.text === 'string') && typeof v.metadata === 'object' && Array.isArray(v.attachments);
}

export async function openMessageEnvelope(args: { id: string; editedAt: string | null; envelope: Envelope; conversationId: string; kind: string; senderId: string | null }): Promise<CacheEntry> {
  const key = `${args.id}:${args.editedAt ?? ''}`;
  const hit = cache.get(key);
  if (hit && (hit.ok || hit.error !== 'NO_DEVICE')) return hit;

  let device = getLocalDevice();
  if (!device) {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return { ok: false, error: 'NO_DEVICE' };
    try {
      device = await ensureLocalDevice(userId);
    } catch {
      return { ok: false, error: 'NO_DEVICE' };
    }
  }
  const envelope = args.envelope;
  if (!envelope?.sender || (args.senderId && envelope.sender.user !== args.senderId)) return remember(key, { ok: false, error: 'CORRUPT' });

  const senderDevice = envelope.sender.user === device.userId && envelope.sender.device === device.deviceId
    ? { signing_key: device.signingKey }
    : await findSenderDevice(envelope.sender.user, envelope.sender.device);
  let senderSigningKey: Uint8Array | null = null;
  try {
    senderSigningKey = senderDevice ? fromBase64(senderDevice.signing_key) : null;
  } catch {
    senderSigningKey = null;
  }

  const opened = openEnvelope({ envelope, context: { conversationId: args.conversationId, kind: args.kind }, device: { deviceId: device.deviceId, keys: device.keys }, senderSigningKey });
  if (!opened.ok) return remember(key, { ok: false, error: opened.reason });
  let payload: unknown;
  try {
    payload = decodePayload<unknown>(opened.payload);
  } catch {
    return remember(key, { ok: false, error: 'CORRUPT' });
  }
  if (!isPayload(payload)) return remember(key, { ok: false, error: 'CORRUPT' });
  return remember(key, { ok: true, parts: { text: payload.text, metadata: payload.metadata ?? {}, attachments: payload.attachments, verified: opened.verified } });
}

function mergeAttachments(rows: MessageAttachment[], secrets: AttachmentSecret[]): MessageAttachment[] {
  return rows.map((row, index) => {
    const secret = secrets[index];
    if (!secret) return row;
    return {
      ...row,
      name: secret.name,
      mime: secret.mime,
      width: secret.width,
      height: secret.height,
      duration_ms: secret.duration_ms,
      waveform: secret.waveform,
      size_bytes: secret.size_bytes ?? row.size_bytes,
      e2ee: { key: secret.key, nonce: secret.nonce, thumb: secret.thumb },
    };
  });
}

/** Kind-aware one-line preview (shared by the inbox, quotes and notifications UI). */
export function previewText(m: { kind: MessageKind | string; text: string | null; deleted?: boolean }): string {
  if (m.deleted) return 'Message deleted';
  switch (m.kind) {
    case 'text':
      return (m.text ?? '').slice(0, 140);
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎤 Voice message';
    case 'document':
      return `📎 ${m.text || 'Document'}`;
    case 'sticker':
      return m.text || 'Sticker';
    case 'gif':
      return 'GIF';
    case 'location':
      return '📍 Location';
    case 'post':
      return 'Shared a post';
    case 'profile':
      return 'Shared a profile';
    case 'story_reply':
      return `Replied to a story${m.text ? `: ${m.text.slice(0, 100)}` : ''}`;
    case 'video_share':
      return 'Shared a video';
    case 'call':
      return '📞 Call';
    default:
      return m.text ?? '';
  }
}

export function undecryptableLabel(error: DecryptError | undefined): string {
  switch (error) {
    case 'NO_KEY_FOR_DEVICE':
      return 'Sent before this device was added. Open it on the device you used at the time.';
    case 'BAD_SIGNATURE':
      return "This message failed verification and isn't shown.";
    case 'NO_DEVICE':
      return 'Setting up encryption on this device…';
    case 'UNSUPPORTED':
      return 'Update Friendzy to read this message.';
    default:
      return "This message couldn't be decrypted on this device.";
  }
}

/** Replaces envelope with plaintext fields on one message (and its quoted message). */
export async function decryptMessage(message: Message): Promise<Message> {
  let out = message;
  if (message.encrypted && message.envelope && !message.deleted) {
    const result = await openMessageEnvelope({ id: message.id, editedAt: message.edited_at, envelope: message.envelope, conversationId: message.conversation_id, kind: message.kind, senderId: message.sender?.id ?? null });
    out = result.ok
      ? { ...message, text: result.parts.text, metadata: result.parts.metadata, attachments: mergeAttachments(message.attachments, result.parts.attachments), verified: result.parts.verified, decrypt_error: undefined }
      : { ...message, text: null, metadata: {}, decrypt_error: result.error };
  }
  if (message.reply_to?.encrypted && message.reply_to.envelope && !message.reply_to.deleted) {
    const quoted = await openMessageEnvelope({ id: message.reply_to.id, editedAt: null, envelope: message.reply_to.envelope, conversationId: message.conversation_id, kind: message.reply_to.kind, senderId: message.reply_to.sender?.id ?? null });
    out = { ...out, reply_to: { ...message.reply_to, preview: quoted.ok ? previewText({ kind: message.reply_to.kind, text: quoted.parts.text }) : '🔒 Encrypted message' } };
  }
  return out;
}

export async function decryptMessages(list: Message[]): Promise<Message[]> {
  const out: Message[] = [];
  for (let i = 0; i < list.length; i += 1) {
    out.push(await decryptMessage(list[i]));
    if (i % 4 === 3) await yieldToUi();
  }
  return out;
}

/** Inbox preview for a sealed last message; null when this device cannot open it. */
export async function decryptPreview(conversationId: string, last: { id: string; kind: MessageKind | string; envelope?: Envelope | null; sender_id: string | null; deleted?: boolean }): Promise<string | null> {
  if (!last.envelope) return null;
  const result = await openMessageEnvelope({ id: last.id, editedAt: null, envelope: last.envelope, conversationId, kind: last.kind, senderId: last.sender_id });
  return result.ok ? previewText({ kind: last.kind, text: result.parts.text, deleted: last.deleted }) : null;
}
