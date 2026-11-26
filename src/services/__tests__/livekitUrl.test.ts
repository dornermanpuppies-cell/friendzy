jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/realtime', () => ({ privateChannel: jest.fn() }));
jest.mock('@/lib/env', () => ({ env: { liveKitUrl: 'wss://friendzy-9kc7beej.livekit.cloud' } }));

import { resolveLiveKitUrl } from '../calls';

describe('resolveLiveKitUrl', () => {
  it('keeps a good wss address from the server', () => {
    expect(resolveLiveKitUrl('wss://friendzy-9kc7beej.livekit.cloud')).toBe('wss://friendzy-9kc7beej.livekit.cloud');
  });

  it('normalises https / bare hosts / trailing slashes to wss', () => {
    expect(resolveLiveKitUrl('https://friendzy-9kc7beej.livekit.cloud/')).toBe('wss://friendzy-9kc7beej.livekit.cloud');
    expect(resolveLiveKitUrl('friendzy-9kc7beej.livekit.cloud')).toBe('wss://friendzy-9kc7beej.livekit.cloud');
    expect(resolveLiveKitUrl('"wss://friendzy-9kc7beej.livekit.cloud"')).toBe('wss://friendzy-9kc7beej.livekit.cloud');
  });

  it('falls back to the build-time address when the server value is unusable', () => {
    expect(resolveLiveKitUrl('http://-9kc7beej.livekit.cloud')).toBe('wss://friendzy-9kc7beej.livekit.cloud');
    expect(resolveLiveKitUrl('')).toBe('wss://friendzy-9kc7beej.livekit.cloud');
    expect(resolveLiveKitUrl(null)).toBe('wss://friendzy-9kc7beej.livekit.cloud');
  });
});
