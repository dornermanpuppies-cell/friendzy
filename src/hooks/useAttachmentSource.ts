import { useEffect, useState } from 'react';

import { isLocalUri, resolveAttachmentUri, type AttachmentVariant } from '@/services/attachments';
import type { MessageAttachment } from '@/types/messaging';

export interface AttachmentSource {
  uri: string | null;
  loading: boolean;
  error: boolean;
}

/**
 * Resolves a chat attachment to a displayable URI: local files immediately,
 * encrypted files after download + decryption on this device, legacy files via
 * a signed URL.
 */
export function useAttachmentSource(attachment: MessageAttachment | null | undefined, variant: AttachmentVariant = 'full'): AttachmentSource {
  const path = attachment ? (variant === 'thumb' ? (attachment.thumbnail_path ?? attachment.path) : attachment.path) : null;
  const key = attachment && path ? `${path}|${variant}|${attachment.e2ee ? 'sealed' : 'plain'}` : null;
  const local = isLocalUri(path);
  const [state, setState] = useState<{ key: string; uri: string | null; error: boolean } | null>(null);

  useEffect(() => {
    if (!attachment || !key || local) return;
    let cancelled = false;
    resolveAttachmentUri(attachment, variant)
      .then((uri) => !cancelled && setState({ key, uri, error: false }))
      .catch((error) => {
        console.warn('[chat] attachment unavailable', error);
        if (!cancelled) setState({ key, uri: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, key, local, variant]);

  if (!attachment || !key) return { uri: null, loading: false, error: false };
  if (local) return { uri: path, loading: false, error: false };
  if (state?.key === key) return { uri: state.uri, loading: false, error: state.error };
  return { uri: null, loading: true, error: false };
}
