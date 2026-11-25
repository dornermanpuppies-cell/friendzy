// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyReleaseSigning } = require('../withAndroidReleaseSigning') as { applyReleaseSigning: (contents: string) => string };

const TEMPLATE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`;

describe('withAndroidReleaseSigning', () => {
  it('adds a release signing config driven by FRIENDZY_UPLOAD_* properties and uses it for release builds', () => {
    const out = applyReleaseSigning(TEMPLATE);
    expect(out).toContain("if (project.hasProperty('FRIENDZY_UPLOAD_STORE_FILE'))");
    expect(out).toContain('storeFile file(FRIENDZY_UPLOAD_STORE_FILE)');
    expect(out).toMatch(/debug\s*\{\s*signingConfig signingConfigs\.debug\s*\}/);
    expect(out).toMatch(/release\s*\{[\s\S]*?signingConfig signingConfigs\.release/);
    expect((out.match(/signingConfig signingConfigs\.debug/g) ?? []).length).toBe(1);
  });

  it('falls back to the debug keystore when no upload keystore is configured', () => {
    const out = applyReleaseSigning(TEMPLATE);
    const releaseBlock = out.slice(out.indexOf('release {'), out.indexOf('buildTypes'));
    expect(releaseBlock).toContain("storeFile file('debug.keystore')");
    expect(releaseBlock).toContain("keyAlias 'androiddebugkey'");
  });

  it('is idempotent', () => {
    const once = applyReleaseSigning(TEMPLATE);
    expect(applyReleaseSigning(once)).toBe(once);
  });

  it('fails loudly when the template changed', () => {
    expect(() => applyReleaseSigning('android { buildTypes { release { } } }')).toThrow(/signingConfigs\.debug not found/);
  });
});
