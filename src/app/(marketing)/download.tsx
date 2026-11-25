import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import type { Metadata } from 'expo-router/server';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';
import { Pill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useInstallPrompt, type InstallBrowser, type InstallPlatform } from '@/hooks/useInstallPrompt';
import { env, integrations } from '@/lib/env';
import { formatBytes, getLatestAndroidRelease, type AndroidRelease } from '@/services/androidRelease';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { timeAgo } from '@/utils/format';

export function generateMetadata(): Metadata {
  return {
    title: 'Download Friendzy — Android app and web app',
    description: 'Download Friendzy for Android straight from this page, or install the web app on any phone or computer. One account on every device.',
  };
}

const siteHost = env.siteUrl.replace(/^https?:\/\//, '');

/** Browser-specific steps for "Add to Home Screen" when there is no one-tap prompt. */
function stepsFor(platform: InstallPlatform, browser: InstallBrowser): { heading: string; steps: string[]; note?: string } {
  if (platform === 'ios') {
    if (browser === 'safari' || browser === 'chrome' || browser === 'edge' || browser === 'firefox') {
      return {
        heading: `Install from ${browser === 'safari' ? 'Safari' : browser === 'chrome' ? 'Chrome' : browser === 'edge' ? 'Edge' : 'Firefox'}`,
        steps: ['Tap the Share button (the square with an arrow).', 'Scroll down and tap "Add to Home Screen".', 'Tap "Add". Friendzy appears on your home screen and opens full-screen.'],
        note: browser === 'safari' ? undefined : 'If "Add to Home Screen" is missing, open this page in Safari and repeat the steps.',
      };
    }
    return { heading: 'Install on iPhone or iPad', steps: ['Open this page in Safari.', 'Tap the Share button, then "Add to Home Screen".', 'Tap "Add".'] };
  }
  if (platform === 'android') {
    if (browser === 'samsung') return { heading: 'Install from Samsung Internet', steps: ['Tap the ≡ menu at the bottom right.', 'Tap "Add page to", then "Home screen" (or tap the download icon in the address bar if it is shown).', 'Confirm. Friendzy appears on your home screen.'] };
    if (browser === 'firefox') return { heading: 'Install from Firefox', steps: ['Tap the ⋮ menu.', 'Tap "Install" or "Add to Home screen".', 'Confirm. Friendzy appears on your home screen.'] };
    if (browser === 'edge') return { heading: 'Install from Edge', steps: ['Tap the ⋯ menu at the bottom.', 'Tap "Add to phone".', 'Confirm. Friendzy appears on your home screen.'] };
    return { heading: 'Install from Chrome', steps: ['Tap the ⋮ menu in the top right corner.', 'Tap "Add to Home screen" or "Install app".', 'Confirm. Friendzy appears on your home screen.'] };
  }
  if (browser === 'safari') return { heading: 'Install on your Mac', steps: ['In the Safari menu bar choose File, then "Add to Dock".', 'Confirm the name and click "Add".', 'Friendzy opens in its own window from the Dock.'], note: 'Requires macOS Sonoma or newer.' };
  if (browser === 'firefox') return { heading: 'Install on your computer', steps: ['Firefox does not install web apps yet.', 'Open this page in Chrome or Edge and use the install icon in the address bar.', `Or simply bookmark ${siteHost}.`] };
  return { heading: `Install from ${browser === 'edge' ? 'Edge' : 'Chrome'}`, steps: ['Click the install icon at the right end of the address bar.', 'Or open the browser menu and choose "Install Friendzy" (under "Cast, save and share" in Chrome).', 'Friendzy opens in its own window and appears in your apps.'] };
}

const APK_STEPS = [
  'Tap "Download for Android". The file is saved to your Downloads.',
  'Open it from the download notification (or your Files app).',
  'If Android asks, allow installs from your browser — a one-time setting.',
  'Tap Install, then Open. Sign in with the account you use on the website.',
];

function Step({ index, text, color }: { index: number; text: string; color: string }) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepIndex, { backgroundColor: color }]}>
        <Text variant="caption" color={palette.white}>
          {index}
        </Text>
      </View>
      <Text variant="body" color="textSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={6}>
      <Text variant="smallMedium" color="primary">
        {label}
      </Text>
    </Pressable>
  );
}

type AndroidSource = { kind: 'play' } | { kind: 'url' } | { kind: 'release'; release: AndroidRelease } | { kind: 'loading' } | { kind: 'none' };

export default function DownloadPage() {
  const { colors } = useTheme();
  const toast = useToast();
  const install = useInstallPrompt();
  const [prompting, setPrompting] = useState(false);
  const release = useAsync(() => getLatestAndroidRelease(), [], { enabled: integrations.githubReleases && !integrations.playStore && !integrations.androidApk });

  const openExternal = (url: string) => {
    Linking.openURL(url).catch(() => toast.error('Could not open that link'));
  };

  const promptInstall = async () => {
    setPrompting(true);
    try {
      const outcome = await install.prompt();
      if (outcome === 'accepted') toast.success('Friendzy is installed', 'Find it on your home screen or in your apps.');
      else if (outcome === 'dismissed') toast.info('Maybe later', 'You can install Friendzy any time from this page.');
    } finally {
      setPrompting(false);
    }
  };

  const android: AndroidSource = integrations.playStore
    ? { kind: 'play' }
    : integrations.androidApk
      ? { kind: 'url' }
      : release.data
        ? { kind: 'release', release: release.data }
        : integrations.githubReleases && release.loading
          ? { kind: 'loading' }
          : { kind: 'none' };
  const androidAvailable = android.kind === 'play' || android.kind === 'url' || android.kind === 'release';
  const androidApkUrl = android.kind === 'url' ? env.androidApkUrl : android.kind === 'release' ? android.release.url : null;

  // Inside the Android app: compare the installed build with the newest release.
  const installedBuild = Platform.OS === 'android' ? Number(Constants.nativeBuildVersion ?? 0) : 0;
  const updateAvailable = Platform.OS === 'android' && android.kind === 'release' && installedBuild > 0 && android.release.build > installedBuild;

  const guide = install.hydrated ? stepsFor(install.platform, install.browser) : null;
  const deviceLabel = install.platform === 'ios' ? 'iPhone or iPad' : install.platform === 'android' ? 'Android phone' : 'computer';

  const webAppBlock = (
    <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="globe-outline" size={24} color={colors.primary} />
        </View>
        <Pill label={install.standalone || install.installed ? 'Installed' : 'Available now'} tone="success" />
      </View>
      {!install.hydrated ? (
        <>
          <Text variant="h3" style={{ marginTop: spacing.md }}>
            Web app for this device
          </Text>
          <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
            Checking what this browser supports…
          </Text>
        </>
      ) : install.platform === 'native' ? (
        <>
          <Text variant="h3" style={{ marginTop: spacing.md }}>
            You are in the Friendzy app
          </Text>
          <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
            {Constants.nativeApplicationVersion ? `Version ${Constants.nativeApplicationVersion}${Constants.nativeBuildVersion ? ` (build ${Constants.nativeBuildVersion})` : ''}. ` : ''}
            Friends can get Friendzy at {siteHost}.
          </Text>
          {updateAvailable && android.kind === 'release' ? (
            <>
              <Text variant="bodySemibold" style={{ marginTop: spacing.lg }}>
                Update available: version {android.release.version} (build {android.release.build})
              </Text>
              <Button title={`Download update (${formatBytes(android.release.sizeBytes)})`} leftIcon="download-outline" glow style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} onPress={() => openExternal(android.release.url)} />
              <Text variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
                Open the downloaded file and tap Install. You stay signed in.
              </Text>
            </>
          ) : null}
        </>
      ) : install.standalone || install.installed ? (
        <>
          <Text variant="h3" style={{ marginTop: spacing.md }}>
            Friendzy web app is installed on this {deviceLabel}
          </Text>
          <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
            {install.standalone ? 'You are using the installed web app right now. It updates itself whenever we ship something new.' : 'Open it from your home screen or app list.'}
          </Text>
          <Button title="Open Friendzy" style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => router.navigate('/home')} />
        </>
      ) : (
        <>
          <Text variant="h3" style={{ marginTop: spacing.md }}>
            {androidAvailable && install.platform === 'android' ? 'Prefer not to install an app file?' : `Install the web app on this ${deviceLabel}`}
          </Text>
          <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
            Adds a Friendzy icon to your home screen that opens full-screen, like an app. It is the same Friendzy, with the same account, messages, videos and coins — no download needed.
          </Text>
          {install.canPrompt ? (
            <Button title="Install web app" variant={androidAvailable ? 'secondary' : 'gradient'} leftIcon="add-circle-outline" glow={!androidAvailable} style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => void promptInstall()} loading={prompting} />
          ) : null}
          {guide ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text variant="smallMedium" color="textMuted" style={{ marginBottom: spacing.sm }}>
                {install.canPrompt ? 'Or install it by hand:' : guide.heading}
              </Text>
              {guide.steps.map((step, i) => (
                <Step key={i} index={i + 1} text={step} color={colors.primary} />
              ))}
              {guide.note ? (
                <Text variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
                  {guide.note}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  const androidCard = (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: androidAvailable ? colors.primary : colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: androidAvailable ? colors.primarySoft : colors.surfaceMuted }]}>
          <Ionicons name="logo-android" size={24} color={androidAvailable ? colors.primary : colors.textMuted} />
        </View>
        <Pill label={android.kind === 'play' ? 'On Google Play' : android.kind === 'url' || android.kind === 'release' ? 'Direct download' : android.kind === 'loading' ? 'Checking…' : 'In preparation'} tone={androidAvailable ? 'success' : 'neutral'} />
      </View>
      <Text variant="h3" style={{ marginTop: spacing.md }}>
        Android
      </Text>
      {android.kind === 'play' ? (
        <>
          <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
            The Android app with native calls, livestreaming and push notifications.
          </Text>
          <Button title="Get it on Google Play" leftIcon="logo-google-playstore" style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => openExternal(env.playStoreUrl)} />
          {integrations.androidApk ? <Button title="Download the .apk instead" variant="secondary" leftIcon="download-outline" style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} onPress={() => openExternal(env.androidApkUrl)} /> : null}
        </>
      ) : android.kind === 'release' || android.kind === 'url' ? (
        <>
          <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
            {android.kind === 'release'
              ? `Version ${android.release.version} (build ${android.release.build}) · ${formatBytes(android.release.sizeBytes)} · updated ${timeAgo(android.release.publishedAt)}. Built and signed from the same code as this website, with native calls, livestreaming and push notifications.`
              : 'The Android app with native calls, livestreaming and push notifications. The file comes only from this page.'}
          </Text>
          <Button title={`Download for Android${android.kind === 'release' ? ` (${formatBytes(android.release.sizeBytes)})` : ' (.apk)'}`} leftIcon="download-outline" glow style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => openExternal(androidApkUrl!)} />
          <View style={{ marginTop: spacing.lg }}>
            {APK_STEPS.map((step, i) => (
              <Step key={i} index={i + 1} text={step} color={colors.primary} />
            ))}
          </View>
          <Text variant="small" color="textMuted" style={{ marginTop: spacing.xs }}>
            Updates: come back here and download the newer build — it installs over the old one and keeps you signed in.
          </Text>
          {android.kind === 'release' ? (
            <View style={styles.links}>
              {android.release.universalUrl ? <LinkText label={`Older 32-bit phones: universal build (${formatBytes(android.release.universalSizeBytes)})`} onPress={() => openExternal(android.release.universalUrl!)} /> : null}
              {android.release.checksumsUrl ? <LinkText label="SHA-256 checksums" onPress={() => openExternal(android.release.checksumsUrl!)} /> : null}
              <LinkText label="Release notes" onPress={() => openExternal(android.release.releasePageUrl)} />
            </View>
          ) : null}
          {android.kind === 'release' && android.release.testSigned ? (
            <Text variant="small" color="textMuted" style={{ marginTop: spacing.sm }}>
              Early-access build signed with a test key. When the final signing key is in place, one reinstall will be needed.
            </Text>
          ) : null}
        </>
      ) : android.kind === 'loading' ? (
        <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
          Looking up the latest Android build…
        </Text>
      ) : (
        <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
          Built from the same code as this website. The download appears here as soon as the first Android build is published; until then the web app is the real Friendzy, not a preview.
        </Text>
      )}
    </View>
  );

  const iosCard = (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: integrations.appStore ? colors.primarySoft : colors.surfaceMuted }]}>
          <Ionicons name="logo-apple" size={24} color={integrations.appStore ? colors.primary : colors.textMuted} />
        </View>
        <Pill label={integrations.appStore ? 'On the App Store' : 'In preparation'} tone={integrations.appStore ? 'success' : 'neutral'} />
      </View>
      <Text variant="h3" style={{ marginTop: spacing.md }}>
        iPhone & iPad
      </Text>
      <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
        {integrations.appStore
          ? 'The iOS app with native calls, livestreaming and push notifications.'
          : 'Apple only allows iPhone apps through the App Store or TestFlight, so there is no file to download. Until the App Store release, add Friendzy to your home screen from Safari for the full-screen experience.'}
      </Text>
      {integrations.appStore ? <Button title="Download on the App Store" leftIcon="logo-apple" style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => openExternal(env.appStoreUrl)} /> : null}
    </View>
  );

  const nativeFirst = androidAvailable && install.platform !== 'ios';

  return (
    <MarketingLayout>
      <MarketingArticle
        title="Download Friendzy"
        subtitle={androidAvailable ? 'The Android app downloads straight from this page. On any other device, install the web app in seconds. One account everywhere.' : 'Install the web app now, straight from this page. The Android and iOS apps appear here the moment they are published. One account everywhere.'}
      >
        {nativeFirst ? (
          <>
            <View style={styles.grid}>
              {androidCard}
              {iosCard}
            </View>
            <Text variant="h2" style={{ marginTop: spacing['3xl'], marginBottom: spacing.lg }}>
              Web app
            </Text>
            {webAppBlock}
          </>
        ) : (
          <>
            {webAppBlock}
            <Text variant="h2" style={{ marginTop: spacing['3xl'], marginBottom: spacing.lg }}>
              Phone apps
            </Text>
            <View style={styles.grid}>
              {androidCard}
              {iosCard}
            </View>
          </>
        )}

        <View style={{ marginTop: spacing['3xl'] }}>
          <Text variant="h3" style={{ marginBottom: spacing.md }}>
            Same Friendzy everywhere
          </Text>
          {[
            'Feeds, stories, messaging, voice notes, voice and video calls, short videos, LIVE, games and your wallet — on the web and in the app.',
            'One account: anything you do on one device is there on the others.',
            'The web app opens full-screen from its own icon and updates automatically; the Android app updates from this page.',
          ].map((line) => (
            <View key={line} style={styles.bullet}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} style={{ marginTop: 2 }} />
              <Text variant="body" color="textSecondary" style={{ flex: 1, marginLeft: spacing.sm }}>
                {line}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: spacing['3xl'] }}>
          <Paragraph>We never link to unofficial downloads. Friendzy is only available from this page and, once released, from Google Play and the App Store. If you see a “Friendzy” app from another publisher, report it to safety@friendzy.app.</Paragraph>
          <Text variant="small" color={palette.ink3}>
            Apple and the Apple logo are trademarks of Apple Inc. Google Play and Android are trademarks of Google LLC.
          </Text>
        </View>
      </MarketingArticle>
    </MarketingLayout>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  card: { flexBasis: 280, flexGrow: 1, borderRadius: radius.xl, borderWidth: 1, padding: spacing['2xl'] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  stepIndex: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm, marginTop: 1 },
  links: { gap: spacing.xs, marginTop: spacing.md },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
});
