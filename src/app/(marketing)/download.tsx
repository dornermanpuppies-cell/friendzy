import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Metadata } from 'expo-router/server';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';
import { Pill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useInstallPrompt, type InstallBrowser, type InstallPlatform } from '@/hooks/useInstallPrompt';
import { env, integrations } from '@/lib/env';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';

export function generateMetadata(): Metadata {
  return {
    title: 'Get Friendzy — install on your phone or computer',
    description: 'Install Friendzy on your home screen in seconds, with the same account on every device. Android and iOS store apps follow once they pass review.',
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

export default function DownloadPage() {
  const { colors } = useTheme();
  const toast = useToast();
  const install = useInstallPrompt();
  const [prompting, setPrompting] = useState(false);

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

  const guide = install.hydrated ? stepsFor(install.platform, install.browser) : null;
  const deviceLabel = install.platform === 'ios' ? 'iPhone or iPad' : install.platform === 'android' ? 'Android phone' : 'computer';

  return (
    <MarketingLayout>
      <MarketingArticle title="Get Friendzy" subtitle="One account on every device. Install the web app now, straight from this page, and the Android and iOS store apps when they are released.">
        {/* Web app install */}
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="phone-portrait-outline" size={24} color={colors.primary} />
            </View>
            <Pill label={install.standalone || install.installed ? 'Installed' : 'Available now'} tone="success" />
          </View>
          {!install.hydrated ? (
            <>
              <Text variant="h3" style={{ marginTop: spacing.md }}>
                Install Friendzy on this device
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
                Nothing to install here. Friends can get Friendzy at {siteHost}.
              </Text>
            </>
          ) : install.standalone || install.installed ? (
            <>
              <Text variant="h3" style={{ marginTop: spacing.md }}>
                Friendzy is installed on this {deviceLabel}
              </Text>
              <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
                {install.standalone ? 'You are using the installed app right now. It updates itself whenever we ship something new.' : 'Open it from your home screen or app list.'}
              </Text>
              <Button title="Open Friendzy" style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => router.navigate('/home')} />
            </>
          ) : (
            <>
              <Text variant="h3" style={{ marginTop: spacing.md }}>
                Install Friendzy on this {deviceLabel}
              </Text>
              <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
                Adds a Friendzy icon to your home screen that opens full-screen, like an app. It is the same Friendzy, with the same account, messages, videos and coins.
              </Text>
              {install.canPrompt ? (
                <Button title="Install app" leftIcon="download-outline" glow style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => void promptInstall()} loading={prompting} />
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

        {/* Store apps */}
        <Text variant="h2" style={{ marginTop: spacing['3xl'], marginBottom: spacing.lg }}>
          Store apps
        </Text>
        <View style={styles.grid}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.header}>
              <View style={[styles.icon, { backgroundColor: integrations.playStore || integrations.androidApk ? colors.primarySoft : colors.surfaceMuted }]}>
                <Ionicons name="logo-android" size={24} color={integrations.playStore || integrations.androidApk ? colors.primary : colors.textMuted} />
              </View>
              <Pill label={integrations.playStore ? 'On Google Play' : integrations.androidApk ? 'Direct download' : 'In preparation'} tone={integrations.playStore || integrations.androidApk ? 'success' : 'neutral'} />
            </View>
            <Text variant="h3" style={{ marginTop: spacing.md }}>
              Android
            </Text>
            <Text variant="body" color="textMuted" style={{ marginTop: 4 }}>
              {integrations.playStore
                ? 'The Android app with native calls, livestreaming and push notifications.'
                : integrations.androidApk
                  ? 'Early access build. Your phone may ask you to allow installs from your browser; the file comes only from this page.'
                  : 'Built from the same code as this website. It ships on Google Play once it passes review. Until then the web app above is the real Friendzy, not a preview.'}
            </Text>
            {integrations.playStore ? <Button title="Get it on Google Play" leftIcon="logo-google-playstore" style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => openExternal(env.playStoreUrl)} /> : null}
            {integrations.androidApk ? <Button title="Download for Android (.apk)" variant={integrations.playStore ? 'secondary' : 'primary'} leftIcon="download-outline" style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} onPress={() => openExternal(env.androidApkUrl)} /> : null}
          </View>
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
              {integrations.appStore ? 'The iOS app with native calls, livestreaming and push notifications.' : 'Ships on the App Store once it passes review. Until then, add Friendzy to your home screen from Safari (steps above) for the full-screen experience.'}
            </Text>
            {integrations.appStore ? <Button title="Download on the App Store" leftIcon="logo-apple" style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} onPress={() => openExternal(env.appStoreUrl)} /> : null}
          </View>
        </View>

        {/* Why the web app is enough today */}
        <View style={{ marginTop: spacing['3xl'] }}>
          <Text variant="h3" style={{ marginBottom: spacing.md }}>
            What the web app gives you today
          </Text>
          {[
            'Feeds, stories, messaging, voice notes, voice and video calls, short videos, LIVE, games and your wallet — everything on this site.',
            'Opens full-screen from your own icon, remembers your sign-in and updates automatically.',
            'The same account everywhere: anything you do here is there when the store apps arrive.',
          ].map((line) => (
            <View key={line} style={styles.bullet}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} style={{ marginTop: 2 }} />
              <Text variant="body" color="textSecondary" style={{ flex: 1, marginLeft: spacing.sm }}>
                {line}
              </Text>
            </View>
          ))}
          <Text variant="small" color="textMuted" style={{ marginTop: spacing.md }}>
            Push notifications arrive with the store apps; on the web you see new activity whenever Friendzy is open.
          </Text>
        </View>

        <View style={{ marginTop: spacing['3xl'] }}>
          <Paragraph>We never link to unofficial downloads. Friendzy is only available from this page and, once released, from Google Play and the App Store. If you see a “Friendzy” app from another publisher, report it to safety@friendzy.app.</Paragraph>
          <Text variant="small" color={palette.ink3}>
            Apple and the Apple logo are trademarks of Apple Inc. Google Play is a trademark of Google LLC.
          </Text>
        </View>
      </MarketingArticle>
    </MarketingLayout>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  card: { flexBasis: 280, flexGrow: 1, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  stepIndex: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm, marginTop: 1 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
});
