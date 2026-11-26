// Hand-written type surface for webpush.vendored.js (jsr:@negrel/webpush@0.5.0). Only the members
// push-dispatch uses are declared. Keep in sync when the vendored version changes.
export declare enum Urgency {
  VeryLow = 'very-low',
  Low = 'low',
  Normal = 'normal',
  High = 'high',
}
export interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}
export interface PushMessageOptions {
  ttl?: number;
  urgency?: Urgency;
  topic?: string;
}
export interface ExportedVapidKeys {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}
export declare class PushMessageError extends Error {
  readonly response: Response;
  readonly subscription: PushSubscription;
  isGone(): boolean;
}
export declare class PushSubscriber {
  pushMessage(message: BufferSource, options?: PushMessageOptions): Promise<void>;
  pushTextMessage(text: string, options?: PushMessageOptions): Promise<void>;
}
export declare class ApplicationServer {
  static new(options: { contactInformation: string; vapidKeys: CryptoKeyPair }): Promise<ApplicationServer>;
  subscribe(subscription: PushSubscription): PushSubscriber;
}
export declare function importVapidKeys(keys: ExportedVapidKeys, options?: { extractable?: boolean }): Promise<CryptoKeyPair>;
export declare function generateVapidKeys(options?: { extractable?: boolean }): Promise<CryptoKeyPair>;
export declare function exportVapidKeys(keys: CryptoKeyPair): Promise<ExportedVapidKeys>;
