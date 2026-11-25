import { parseAuthUrl, safeNextPath } from '../authUrl';

describe('parseAuthUrl', () => {
  it('reads PKCE codes and next paths from the query string', () => {
    const p = parseAuthUrl('https://friendzy.app/auth/callback?code=abc123&next=%2Fsettings%2Faccount');
    expect(p.code).toBe('abc123');
    expect(p.next).toBe('/settings/account');
  });

  it('reads implicit tokens from the hash fragment', () => {
    const p = parseAuthUrl('friendzy://auth/callback#access_token=AT&refresh_token=RT&type=recovery&expires_in=3600');
    expect(p.accessToken).toBe('AT');
    expect(p.refreshToken).toBe('RT');
    expect(p.type).toBe('recovery');
  });

  it('reads errors', () => {
    const p = parseAuthUrl('https://friendzy.app/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(p.error).toBe('access_denied');
    expect(p.errorDescription).toBe('Email link is invalid or has expired');
  });

  it('handles empty input', () => {
    expect(parseAuthUrl(null)).toEqual({});
  });
});

describe('safeNextPath', () => {
  it('only allows in-app relative paths', () => {
    expect(safeNextPath('/home')).toBe('/home');
    expect(safeNextPath('//evil.com')).toBe('/home');
    expect(safeNextPath('https://evil.com')).toBe('/home');
    expect(safeNextPath(undefined, '/profile')).toBe('/profile');
  });
});
