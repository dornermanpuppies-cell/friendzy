import { formatBytes, parseGitHubRelease, type GitHubRelease } from '../androidRelease';

const base: GitHubRelease = {
  tag_name: 'android-v0.1.0-42',
  name: 'Friendzy for Android v0.1.0 (build 42)',
  body: 'Install: …\n\nSigning: debug keystore (test signing).',
  draft: false,
  prerelease: false,
  published_at: '2026-11-25T20:00:00Z',
  html_url: 'https://github.com/acme/friendzy/releases/tag/android-v0.1.0-42',
  assets: [
    { name: 'friendzy-android.apk', size: 95_000_000, browser_download_url: 'https://github.com/acme/friendzy/releases/download/android-v0.1.0-42/friendzy-android.apk' },
    { name: 'friendzy-android-arm64.apk', size: 58_000_000, browser_download_url: 'https://github.com/acme/friendzy/releases/download/android-v0.1.0-42/friendzy-android-arm64.apk' },
    { name: 'sha256sums.txt', size: 200, browser_download_url: 'https://github.com/acme/friendzy/releases/download/android-v0.1.0-42/sha256sums.txt' },
  ],
};

describe('parseGitHubRelease', () => {
  it('prefers the arm64 APK, keeps the universal one as fallback and reads version/build from the tag', () => {
    const r = parseGitHubRelease(base);
    expect(r).not.toBeNull();
    expect(r!.version).toBe('0.1.0');
    expect(r!.build).toBe(42);
    expect(r!.url).toContain('friendzy-android-arm64.apk');
    expect(r!.sizeBytes).toBe(58_000_000);
    expect(r!.universalUrl).toContain('friendzy-android.apk');
    expect(r!.checksumsUrl).toContain('sha256sums.txt');
    expect(r!.testSigned).toBe(true);
  });

  it('recognises a properly signed build', () => {
    expect(parseGitHubRelease({ ...base, body: 'Signing: release keystore.' })!.testSigned).toBe(false);
  });

  it('ignores drafts, pre-releases and releases without an APK', () => {
    expect(parseGitHubRelease({ ...base, draft: true })).toBeNull();
    expect(parseGitHubRelease({ ...base, prerelease: true })).toBeNull();
    expect(parseGitHubRelease({ ...base, assets: base.assets.filter((a) => !a.name.endsWith('.apk')) })).toBeNull();
  });

  it('copes with a single APK and a foreign tag', () => {
    const r = parseGitHubRelease({ ...base, tag_name: 'v1.2.3', assets: [base.assets[0]] });
    expect(r!.url).toContain('friendzy-android.apk');
    expect(r!.universalUrl).toBeNull();
    expect(r!.version).toBe('1.2.3');
    expect(r!.build).toBe(0);
  });
});

describe('formatBytes', () => {
  it('formats sizes for the download button', () => {
    expect(formatBytes(58_000_000)).toBe('55.3 MB');
    expect(formatBytes(120_000_000)).toBe('114 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(null)).toBe('');
  });
});
