import { supabase } from '@/lib/supabase';
import { guessMime, objectPath, prepareImage, uploadFile } from '@/services/upload';
import type { VerificationRequest } from '@/types/admin';
import type { Json } from '@/types/database';

export const VERIFICATION_CATEGORIES: { id: VerificationRequest['category']; label: string; description: string }[] = [
  { id: 'creator', label: 'Creator', description: 'Content creator, streamer, artist or musician' },
  { id: 'public_figure', label: 'Public figure', description: 'Athlete, journalist, politician, influencer' },
  { id: 'business', label: 'Business', description: 'Brand, company or organisation' },
  { id: 'community', label: 'Community', description: 'Club, school, NGO or community page' },
  { id: 'other', label: 'Other', description: 'Something else — tell us in the note' },
];

/** Uploads an identity/ownership document to the private `verification` bucket (admins only can read it). */
export async function uploadVerificationDocument(userId: string, uri: string): Promise<string> {
  const mime = guessMime(uri, 'image/jpeg');
  if (mime.startsWith('image/')) {
    const prepared = await prepareImage(uri, { maxDimension: 2000, quality: 0.85 });
    const path = objectPath(userId, 'doc', prepared.mime);
    await uploadFile({ bucket: 'verification', path, uri: prepared.uri, contentType: prepared.mime, maxBytes: 10_000_000 });
    return path;
  }
  const path = objectPath(userId, 'doc', mime);
  await uploadFile({ bucket: 'verification', path, uri, contentType: mime, maxBytes: 10_000_000 });
  return path;
}

export async function requestVerification(input: { full_name: string; category: VerificationRequest['category']; links: string[]; document_path?: string | null; note?: string | null }): Promise<VerificationRequest> {
  const { data, error } = await supabase.rpc('request_verification', {
    p_full_name: input.full_name,
    p_category: input.category,
    p_links: input.links as unknown as Json,
    p_document_path: input.document_path ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
  return data as unknown as VerificationRequest;
}

export async function getMyVerificationRequest(): Promise<VerificationRequest | null> {
  const { data, error } = await supabase.rpc('get_my_verification_request');
  if (error) throw error;
  return (data as unknown as VerificationRequest | null) ?? null;
}
