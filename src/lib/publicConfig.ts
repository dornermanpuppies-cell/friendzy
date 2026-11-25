/**
 * Forgiving readers for pasted public configuration (EXPO_PUBLIC_* values).
 *
 * People paste these into dashboards by hand, and the two mistakes that keep
 * coming back are wrapping quotes and a missing scheme. Both are repaired here
 * at runtime (and by scripts/prepare-web-build.mjs at build time, which also
 * tells the person what it fixed). Nothing here ever invents a value.
 */

/** Trims and removes up to two layers of wrapping quotes/backticks. */
export function stripWrappingQuotes(value: string | null | undefined): string {
  let s = String(value ?? '').trim();
  for (let i = 0; i < 2; i += 1) {
    const m = /^(['"`])([\s\S]*)\1$/.exec(s);
    if (!m) break;
    s = m[2].trim();
  }
  return s;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;

/**
 * Normalises a public URL: strips quotes and whitespace, prepends the given
 * scheme when a bare host was given (`acme.supabase.co` → `https://acme.supabase.co`)
 * and drops a trailing slash. Returns '' for an empty value.
 */
export function normalizePublicUrl(value: string | null | undefined, scheme: 'https' | 'wss'): string {
  let v = stripWrappingQuotes(value);
  if (!v) return '';
  if (!HAS_SCHEME.test(v) && BARE_HOST.test(v)) v = `${scheme}://${v}`;
  return v.replace(/\/+$/, '');
}
