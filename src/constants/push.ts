/**
 * Web Push application-server (VAPID) public key.
 *
 * The matching private key lives only in the `push-dispatch` Edge Function
 * secrets (VAPID_PRIVATE_KEY). A VAPID public key is safe to ship in the client:
 * browsers use it to tie a push subscription to this application server, and
 * push services verify every message against it.
 *
 * Rotating the key pair: generate a new pair, update the function secrets, set
 * EXPO_PUBLIC_VAPID_PUBLIC_KEY (or this fallback) and redeploy; existing
 * subscriptions re-subscribe automatically on their next visit.
 */
export const VAPID_PUBLIC_KEY = (process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? 'BDaFID5N46bGawD3WofKctfobPiMmYA3kkcXQA8ASCk8KW-0WZ9ZKioTHzhhGq7M5i_QwtlyxYqhs9wgc84ytbU').trim();

/** Expo (EAS) project the Android/iOS builds belong to; needed to mint Expo push tokens. */
export const EAS_PROJECT_ID = '026ee88e-cff5-49eb-905a-5e8212fa71d9';
