import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { AppError } from '@/utils/errors';

export type ProfileImageKind = 'avatar' | 'cover';

const BUCKETS: Record<ProfileImageKind, string> = { avatar: 'avatars', cover: 'covers' };
const MAX_BYTES: Record<ProfileImageKind, number> = { avatar: 5 * 1024 * 1024, cover: 8 * 1024 * 1024 };

export interface PickedImage {
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  fileSize?: number;
}

/**
 * Opens the photo library (or file picker on web) and returns a single image.
 * Returns null when the user cancels.
 */
export async function pickImage(kind: ProfileImageKind): Promise<PickedImage | null> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new AppError('Friendzy needs access to your photos to continue. You can allow it in Settings.', 'permission_denied');
    }
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: Platform.OS !== 'web',
    aspect: kind === 'avatar' ? [1, 1] : [16, 9],
    quality: 0.85,
    exif: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? guessMimeType(asset.uri),
    width: asset.width,
    height: asset.height,
    fileSize: asset.fileSize ?? undefined,
  };
}

export async function takePhoto(kind: ProfileImageKind): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new AppError('Friendzy needs camera access to take a photo.', 'permission_denied');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: kind === 'avatar' ? [1, 1] : [16, 9],
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? guessMimeType(asset.uri), width: asset.width, height: asset.height };
}

function guessMimeType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.startsWith('data:')) return lower.slice(5, lower.indexOf(';')) || 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function extensionFor(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new AppError('Could not read the selected image.');
  return response.arrayBuffer();
}

/**
 * Uploads a profile picture or cover image to Supabase Storage under the
 * user's own folder (enforced by storage RLS) and returns its public URL.
 */
export async function uploadProfileImage(userId: string, kind: ProfileImageKind, image: PickedImage): Promise<string> {
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType) ? image.mimeType : 'image/jpeg';
  const bytes = await readBytes(image.uri);
  if (bytes.byteLength > MAX_BYTES[kind]) {
    throw new AppError(`Please choose an image smaller than ${Math.round(MAX_BYTES[kind] / 1024 / 1024)} MB.`, 'file_too_large');
  }
  const path = `${userId}/${kind}-${Date.now()}.${extensionFor(mime)}`;
  const bucket = BUCKETS[kind];
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: mime,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export interface PickedMedia {
  uri: string;
  kind: 'image' | 'video';
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fileSize?: number;
}

/** Picks one or more photos/videos for posts, stories and chats. */
export async function pickMedia(options: { kinds?: ('images' | 'videos')[]; multiple?: boolean; max?: number; quality?: number } = {}): Promise<PickedMedia[]> {
  const { kinds = ['images', 'videos'], multiple = false, max = 10, quality = 0.9 } = options;
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new AppError('Friendzy needs access to your photos and videos to continue. You can allow it in Settings.', 'permission_denied');
    }
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kinds,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? max : 1,
    quality,
    videoMaxDuration: 180,
    exif: false,
    orderedSelection: true,
  });
  if (result.canceled || !result.assets?.length) return [];
  return result.assets.slice(0, max).map((asset) => ({
    uri: asset.uri,
    kind: asset.type === 'video' ? 'video' : 'image',
    mime: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : guessMimeType(asset.uri)),
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration ?? undefined,
    fileSize: asset.fileSize ?? undefined,
  }));
}

/** Captures a photo or a video with the camera. */
export async function captureMedia(kind: 'image' | 'video'): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new AppError('Friendzy needs camera access to continue.', 'permission_denied');
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: kind === 'video' ? ['videos'] : ['images'], quality: 0.9, videoMaxDuration: 180 });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    kind: asset.type === 'video' ? 'video' : 'image',
    mime: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : guessMimeType(asset.uri)),
    width: asset.width,
    height: asset.height,
    durationMs: asset.duration ?? undefined,
    fileSize: asset.fileSize ?? undefined,
  };
}

/** Best-effort cleanup of a previous image in the user's folder. */
export async function removeProfileImage(kind: ProfileImageKind, publicUrl: string | null | undefined): Promise<void> {
  if (!publicUrl) return;
  const marker = `/object/public/${BUCKETS[kind]}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(publicUrl.slice(idx + marker.length).split('?')[0]);
  await supabase.storage.from(BUCKETS[kind]).remove([path]).catch(() => undefined);
}
