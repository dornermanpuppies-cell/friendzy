import { env, integrations } from '@/lib/env';

/**
 * Latest Android APK published by .github/workflows/android-apk.yml as a GitHub release.
 * Read through the public GitHub API (CORS-enabled, 60 requests/hour per IP, cached here),
 * so the Download page shows a real file with its real size — or nothing.
 */
export interface AndroidRelease {
  /** e.g. "0.1.0" */
  version: string;
  /** Monotonic build number (Android versionCode). */
  build: number;
  tag: string;
  publishedAt: string;
  /** Recommended download (arm64-v8a). */
  url: string;
  sizeBytes: number;
  /** Fallback for old 32-bit phones, when published. */
  universalUrl: string | null;
  universalSizeBytes: number | null;
  checksumsUrl: string | null;
  /** True when the release notes say the APK is signed with the debug (test) keystore. */
  testSigned: boolean;
  releasePageUrl: string;
}

export interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: GitHubAsset[];
}

const TAG_RE = /^android-v(\d+\.\d+\.\d+(?:[-+][\w.]+)?)-(\d+)$/;
const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; value: AndroidRelease | null } | null = null;
let inflight: Promise<AndroidRelease | null> | null = null;

/** Maps a GitHub release to an Android download, or null when it carries no APK. */
export function parseGitHubRelease(r: GitHubRelease): AndroidRelease | null {
  if (r.draft || r.prerelease) return null;
  const apks = r.assets.filter((a) => a.name.toLowerCase().endsWith('.apk'));
  if (apks.length === 0) return null;
  const primary = apks.find((a) => /arm64/i.test(a.name)) ?? apks[0];
  const universal = apks.find((a) => a !== primary && !/arm64|x86/i.test(a.name)) ?? null;
  const checksums = r.assets.find((a) => /sha256/i.test(a.name)) ?? null;
  const m = TAG_RE.exec(r.tag_name);
  const version = m?.[1] ?? r.tag_name.replace(/^(android-)?v?/i, '');
  const build = m ? Number(m[2]) : 0;
  return {
    version,
    build,
    tag: r.tag_name,
    publishedAt: r.published_at,
    url: primary.browser_download_url,
    sizeBytes: primary.size,
    universalUrl: universal?.browser_download_url ?? null,
    universalSizeBytes: universal?.size ?? null,
    checksumsUrl: checksums?.browser_download_url ?? null,
    testSigned: /signing:\s*debug/i.test(r.body ?? ''),
    releasePageUrl: r.html_url,
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404 || res.status === 403 || res.status === 401) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Resolves the newest release that carries an APK, or null when the repository is private,
 * unknown, or has no Android release yet. Never throws — the Download page degrades to
 * "in preparation".
 */
export async function getLatestAndroidRelease(options: { force?: boolean } = {}): Promise<AndroidRelease | null> {
  if (!integrations.githubReleases) return null;
  if (!options.force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const base = `https://api.github.com/repos/${env.githubRepo}/releases`;
      const latest = await fetchJson<GitHubRelease>(`${base}/latest`);
      let value = latest ? parseGitHubRelease(latest) : null;
      if (!value && latest) {
        // The newest release is something else (e.g. iOS) — look a little further back.
        const list = (await fetchJson<GitHubRelease[]>(`${base}?per_page=15`)) ?? [];
        value = list.map(parseGitHubRelease).find((r): r is AndroidRelease => r !== null) ?? null;
      }
      cache = { at: Date.now(), value };
      return value;
    } catch {
      return cache?.value ?? null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}
