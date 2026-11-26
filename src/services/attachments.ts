import { Linking } from 'react-native';

import { decryptRemoteFile, materialFromSecret, openLocalFile } from '@/lib/e2ee/io';
import { getSignedChatUrl } from '@/services/messaging';
import { extensionForMime } from '@/services/upload';
import type { MessageAttachment } from '@/types/messaging';

const DIRECT = /^(file:|content:|blob:|data:|https?:)/;

export function isLocalUri(path: string | null | undefined): boolean {
  return Boolean(path) && DIRECT.test(path!);
}

function cacheName(path: string): string {
  let hash = 5381;
  for (let i = 0; i < path.length; i += 1) hash = ((hash << 5) + hash + path.charCodeAt(i)) >>> 0;
  return `${hash.toString(16)}-${path.length}`;
}

export type AttachmentVariant = 'full' | 'thumb';

/**
 * Turns a chat attachment into something the UI can display:
 * - optimistic local files are returned as-is,
 * - end-to-end encrypted files are downloaded and decrypted on this device,
 * - attachments from before encryption get a short-lived signed URL.
 */
export async function resolveAttachmentUri(attachment: MessageAttachment, variant: AttachmentVariant = 'full'): Promise<string> {
  const useThumb = variant === 'thumb' && Boolean(attachment.thumbnail_path) && (!attachment.e2ee || Boolean(attachment.e2ee.thumb));
  const path = useThumb ? attachment.thumbnail_path! : attachment.path;
  if (DIRECT.test(path)) return path;
  if (!attachment.e2ee) return getSignedChatUrl(path);
  const secret = useThumb && attachment.e2ee.thumb ? attachment.e2ee.thumb : attachment.e2ee;
  const mime = useThumb ? 'image/jpeg' : attachment.mime || 'application/octet-stream';
  const url = await getSignedChatUrl(path);
  return decryptRemoteFile(url, materialFromSecret(secret), { cacheName: cacheName(path), mime, ext: extensionForMime(mime) });
}

/** Opens (or downloads / shares) the full attachment. */
export async function openAttachment(attachment: MessageAttachment): Promise<void> {
  const uri = await resolveAttachmentUri(attachment, 'full');
  if (!attachment.e2ee && /^https?:/.test(uri)) {
    await Linking.openURL(uri);
    return;
  }
  await openLocalFile(uri, { mime: attachment.mime || 'application/octet-stream', name: attachment.name });
}
