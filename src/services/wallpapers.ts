import { supabase } from '@/lib/supabase';
import { objectPath, prepareImage, uploadFile } from '@/services/upload';

const BUCKET = 'wallpapers';
const PREFIX = 'img:';
const signed = new Map<string, { url: string; expires: number }>();

/** True when the stored value points at a photo rather than one of the built-in presets. */
export function isImageWallpaper(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Storage path inside the private wallpapers bucket, or null for a preset. */
export function wallpaperPath(value: string | null | undefined): string | null {
  return isImageWallpaper(value) ? (value as string).slice(PREFIX.length) : null;
}

/**
 * Puts a photo from the phone into the caller's own folder of the private wallpapers bucket and
 * returns the value to store on the chat (or as the account default).
 */
export async function uploadChatWallpaper(userId: string, uri: string): Promise<string> {
  const prepared = await prepareImage(uri, { maxDimension: 1600, quality: 0.82 });
  const path = objectPath(userId, 'wallpaper', prepared.mime);
  await uploadFile({ bucket: BUCKET, path, uri: prepared.uri, contentType: prepared.mime, maxBytes: 8_000_000 });
  return `${PREFIX}${path}`;
}

/**
 * A viewable URL for a stored wallpaper. The bucket is private — a wallpaper is often a personal
 * photo — so this signs a long-lived URL and keeps it for the session.
 */
export async function getWallpaperUrl(value: string, ttlSeconds = 7 * 24 * 3600): Promise<string | null> {
  const path = wallpaperPath(value);
  if (!path) return null;
  const cached = signed.get(path);
  if (cached && cached.expires > Date.now() + 60_000) return cached.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  signed.set(path, { url: data.signedUrl, expires: Date.now() + ttlSeconds * 1000 });
  return data.signedUrl;
}

/** Removes a wallpaper photo from storage once nothing points at it any more. */
export async function deleteWallpaperFile(value: string | null | undefined): Promise<void> {
  const path = wallpaperPath(value);
  if (!path) return;
  signed.delete(path);
  await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
}
