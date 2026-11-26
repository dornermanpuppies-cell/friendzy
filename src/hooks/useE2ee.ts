import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ensureLocalDevice, getRecipients, invalidateRecipients, resetLocalDevice, type RecipientSet } from '@/lib/e2ee/devices';
import { decryptPreview } from '@/lib/e2ee/messages';
import { useE2eeStore } from '@/store/e2eeStore';
import type { ConversationSummary } from '@/types/messaging';
import { getErrorMessage } from '@/utils/errors';

/**
 * Creates/loads this device's key pair and registers its public keys as soon as
 * a user is signed in; forgets the in-memory identity on sign-out.
 */
export function useE2eeSetup(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) {
      resetLocalDevice();
      return;
    }
    let cancelled = false;
    const run = () => ensureLocalDevice(userId).catch((error) => !cancelled && console.warn('[e2ee] device setup failed', getErrorMessage(error)));
    void run();
    // Retry when the app returns to the foreground (e.g. first launch while offline).
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && useE2eeStore.getState().status === 'error') void run();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId]);
}

export interface EncryptionStatus {
  /** This device has keys and every member of the conversation has at least one device. */
  ready: boolean;
  loading: boolean;
  /** Member ids that have not registered any device yet. */
  missing: string[];
  deviceCount: number;
  error: string | null;
  refresh: () => void;
}

/** Whether messages can be sealed for everyone in a conversation (polls while someone has no keys yet). */
export function useEncryptionStatus(conversationId: string | undefined, enabled = true): EncryptionStatus {
  const deviceStatus = useE2eeStore((s) => s.status);
  const [state, setState] = useState<{ id: string; recipients: RecipientSet | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !conversationId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = (force: boolean) => {
      getRecipients(conversationId, { force })
        .then((recipients) => {
          if (cancelled) return;
          setState({ id: conversationId, recipients, error: null });
          // Someone has no keys yet: check again shortly (they may be opening the app right now).
          if (recipients.missing.length > 0) timer = setTimeout(() => run(true), 15_000);
        })
        .catch((error) => {
          if (!cancelled) setState({ id: conversationId, recipients: null, error: getErrorMessage(error) });
        });
    };
    run(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, conversationId, tick]);

  const refresh = useCallback(() => {
    if (conversationId) invalidateRecipients(conversationId);
    setTick((t) => t + 1);
  }, [conversationId]);

  const current = state?.id === conversationId ? state : null;
  return {
    ready: deviceStatus === 'ready' && Boolean(current?.recipients) && (current?.recipients?.missing.length ?? 1) === 0,
    loading: !current && deviceStatus !== 'error',
    missing: current?.recipients?.missing ?? [],
    deviceCount: current?.recipients?.devices.length ?? 0,
    error: current?.error ?? (deviceStatus === 'error' ? (useE2eeStore.getState().error ?? 'Encryption setup failed') : null),
    refresh,
  };
}

const PLACEHOLDER = '🔒 Encrypted message';

/** Decrypts the inbox preview of a conversation's last message on this device. */
export function useDecryptedPreview(conversation: ConversationSummary): string {
  const last = conversation.last_message;
  const needsDecrypt = Boolean(last?.encrypted && last.envelope && !last.deleted);
  const [preview, setPreview] = useState<{ id: string; text: string | null } | null>(null);
  const deviceStatus = useE2eeStore((s) => s.status);

  useEffect(() => {
    if (!last || !needsDecrypt) return;
    let cancelled = false;
    decryptPreview(conversation.id, last)
      .then((text) => !cancelled && setPreview({ id: last.id, text }))
      .catch(() => !cancelled && setPreview({ id: last.id, text: null }));
    return () => {
      cancelled = true;
    };
  }, [conversation.id, last, needsDecrypt, deviceStatus]);

  if (!last) return '';
  if (!needsDecrypt) return last.preview;
  return preview?.id === last.id && preview.text !== null ? preview.text : PLACEHOLDER;
}
