/**
 * Parses Supabase auth redirect URLs. Supports both the PKCE `?code=` form and
 * the implicit `#access_token=…` fragment form, plus error parameters.
 */
export interface AuthUrlParams {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenHash?: string;
  type?: string;
  next?: string;
  error?: string;
  errorDescription?: string;
}

export function parseAuthUrl(url: string | null | undefined): AuthUrlParams {
  if (!url) return {};
  const out: AuthUrlParams = {};
  const [withoutHash, hash = ''] = url.split('#');
  const queryIndex = withoutHash.indexOf('?');
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const read = (raw: string) => {
    if (!raw) return;
    for (const part of raw.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
      const value = eq >= 0 ? decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' ')) : '';
      switch (key) {
        case 'code':
          out.code = value;
          break;
        case 'access_token':
          out.accessToken = value;
          break;
        case 'refresh_token':
          out.refreshToken = value;
          break;
        case 'token_hash':
          out.tokenHash = value;
          break;
        case 'type':
          out.type = value;
          break;
        case 'next':
          out.next = value;
          break;
        case 'error':
        case 'error_code':
          out.error = out.error ?? value;
          break;
        case 'error_description':
          out.errorDescription = value;
          break;
      }
    }
  };

  read(query);
  read(hash);
  return out;
}

/** Only allow in-app relative paths as post-auth destinations. */
export function safeNextPath(next: string | undefined, fallback = '/home'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
