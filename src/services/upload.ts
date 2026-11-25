import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image, Platform } from 'react-native';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { AppError } from '@/utils/errors';

export interface UploadProgress {
  loaded: number;
  total: number;
  fraction: number;
}

export interface UploadParams {
  bucket: string;
  /** Object path inside the bucket. Must start with the uploader's user id (storage RLS). */
  path: string;
  uri: string;
  contentType: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  maxBytes?: number;
  retries?: number;
}

export interface UploadResult {
  path: string;
  publicUrl: string;
  bytes: number;
}

export function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/mpeg': 'mp3',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? 'bin';
}

export function guessMime(uri: string, fallback = 'application/octet-stream'): string {
  const lower = uri.toLowerCase().split('?')[0];
  if (lower.startsWith('data:')) return lower.slice(5, lower.indexOf(';')) || fallback;
  if (/\.(jpe?g)$/.test(lower)) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.m4a')) return 'audio/m4a';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
}

export function objectPath(userId: string, kind: string, mime: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${userId}/${kind}-${Date.now()}-${rand}.${extensionForMime(mime)}`;
}

async function readBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  if (!response.ok) throw new AppError('Could not read the selected file.');
  return response.blob();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads a local file (file://, content://, blob: or data: URI) to Supabase
 * Storage with real progress events. Uses a short-lived signed upload URL so
 * the request is authorised per object, and retries transient failures.
 */
export async function uploadFile({ bucket, path, uri, contentType, onProgress, signal, maxBytes, retries = 2 }: UploadParams): Promise<UploadResult> {
  const blob = await readBlob(uri);
  if (maxBytes && blob.size > maxBytes) {
    throw new AppError(`This file is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`, 'file_too_large');
  }
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session.session?.access_token;

  let attempt = 0;
  let lastError: unknown;
  while (attempt <= retries) {
    if (signal?.aborted) throw new AppError('Upload cancelled.', 'aborted');
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data) throw error ?? new AppError('Could not prepare the upload.');
      await putWithProgress(data.signedUrl, blob, contentType, onProgress, signal, accessToken);
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
      return { path, publicUrl: pub.publicUrl, bytes: blob.size };
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const retryable = status === undefined || status >= 500 || status === 429;
      if (!retryable || attempt === retries || signal?.aborted) break;
      await sleep(600 * 2 ** attempt);
      attempt += 1;
    }
  }
  throw lastError instanceof Error ? lastError : new AppError('Upload failed. Check your connection and try again.');
}

function putWithProgress(url: string, body: Blob, contentType: string, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal, accessToken?: string) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('apikey', env.supabaseAnonKey);
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const total = event.lengthComputable ? event.total : body.size;
      onProgress({ loaded: event.loaded, total, fraction: total ? Math.min(1, event.loaded / total) : 0 });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: body.size, total: body.size, fraction: 1 });
        resolve();
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          message = parsed.message ?? parsed.error ?? message;
        } catch {
          /* ignore */
        }
        const err = new AppError(message, 'upload_failed') as AppError & { status?: number };
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new AppError('Network error during upload.', 'network'));
    xhr.onabort = () => reject(new AppError('Upload cancelled.', 'aborted'));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
  mime: 'image/jpeg' | 'image/png';
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * Downscales large images (long edge ≤ maxDimension) and re-encodes as JPEG so
 * uploads stay small on slow connections. PNGs with transparency are kept as PNG.
 */
export async function prepareImage(uri: string, options: { maxDimension?: number; quality?: number; keepPng?: boolean } = {}): Promise<PreparedImage> {
  const { maxDimension = 1920, quality = 0.85, keepPng = false } = options;
  let size = { width: 0, height: 0 };
  try {
    size = await getImageSize(uri);
  } catch {
    /* unknown size; still re-encode */
  }
  const longest = Math.max(size.width, size.height);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const context = ImageManipulator.manipulate(uri);
  if (scale < 1) {
    context.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) });
  }
  const rendered = await context.renderAsync();
  const isPng = keepPng && guessMime(uri) === 'image/png';
  const saved = await rendered.saveAsync({ compress: quality, format: isPng ? SaveFormat.PNG : SaveFormat.JPEG });
  rendered.release();
  return { uri: saved.uri, width: saved.width, height: saved.height, mime: isPng ? 'image/png' : 'image/jpeg' };
}

export const isWeb = Platform.OS === 'web';
