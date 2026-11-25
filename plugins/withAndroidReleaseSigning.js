// Friendzy — Expo config plugin: release signing for the generated Android project.
//
// `npx expo prebuild` regenerates android/ from app.config.ts, so the signing config cannot be
// edited by hand there. This plugin adds a `release` signing config to android/app/build.gradle
// that uses the upload keystore when these Gradle properties exist (CI writes them to
// ~/.gradle/gradle.properties from GitHub secrets; locally you can do the same):
//
//   FRIENDZY_UPLOAD_STORE_FILE      path relative to android/app (e.g. friendzy-upload.keystore)
//   FRIENDZY_UPLOAD_STORE_PASSWORD
//   FRIENDZY_UPLOAD_KEY_ALIAS
//   FRIENDZY_UPLOAD_KEY_PASSWORD
//
// Without them the release build falls back to the template debug keystore, so
// `./gradlew assembleRelease` keeps working for local testing. Nothing secret is stored here.
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING_CONFIG = `
        release {
            // Added by plugins/withAndroidReleaseSigning.js (Friendzy)
            if (project.hasProperty('FRIENDZY_UPLOAD_STORE_FILE')) {
                storeFile file(FRIENDZY_UPLOAD_STORE_FILE)
                storePassword FRIENDZY_UPLOAD_STORE_PASSWORD
                keyAlias FRIENDZY_UPLOAD_KEY_ALIAS
                keyPassword FRIENDZY_UPLOAD_KEY_PASSWORD
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }`;

/** Pure transform (exported for tests). */
function applyReleaseSigning(contents) {
  if (contents.includes('FRIENDZY_UPLOAD_STORE_FILE')) return contents;

  const debugConfig = /signingConfigs\s*\{\s*debug\s*\{[^}]*\}/;
  if (!debugConfig.test(contents)) {
    throw new Error('withAndroidReleaseSigning: signingConfigs.debug not found in android/app/build.gradle — the Expo template changed; update the plugin.');
  }
  let next = contents.replace(debugConfig, (match) => `${match}${RELEASE_SIGNING_CONFIG}`);

  const releaseBuildType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseBuildType.test(next)) {
    throw new Error('withAndroidReleaseSigning: buildTypes.release.signingConfig not found in android/app/build.gradle — the Expo template changed; update the plugin.');
  }
  next = next.replace(releaseBuildType, '$1signingConfig signingConfigs.release');
  return next;
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning: only Groovy build.gradle files are supported.');
    }
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
