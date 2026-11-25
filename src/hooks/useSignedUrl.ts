import { useEffect, useState } from 'react';

import { getSignedChatUrl } from '@/services/messaging';

const DIRECT = /^(file:|content:|blob:|data:|https?:)/;

/**
 * Resolves a private chat-bucket path to a short-lived signed URL.
 * Local URIs (optimistic sends) and absolute URLs are returned unchanged.
 */
export function useSignedUrl(path: string | null | undefined): string | null {
  const needsSigning = Boolean(path) && !DIRECT.test(path!);
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!path || !needsSigning) return;
    let cancelled = false;
    getSignedChatUrl(path)
      .then((url) => {
        if (!cancelled) setSigned({ path, url });
      })
      .catch(() => {
        if (!cancelled) setSigned({ path, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [path, needsSigning]);

  if (!path) return null;
  if (!needsSigning) return path;
  return signed?.path === path ? signed.url : null;
}
