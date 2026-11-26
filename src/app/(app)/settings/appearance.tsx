import { Ionicons } from '@/components/ui/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { getPremiumStatus } from '@/services/premium';
import { updateMySettings } from '@/services/profiles';
import { useAuthStore } from '@/store/authStore';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { ACCENTS } from '@/types/economy';
import { getErrorMessage } from '@/utils/errors';

const OPTIONS: { id: ThemePreference; label: string; description: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'system', label: 'System', description: 'Match your device settings', icon: 'phone-portrait-outline' },
  { id: 'light', label: 'Light', description: 'Bright, clean surfaces', icon: 'sunny-outline' },
  { id: 'dark', label: 'Dark', description: 'Deep purple night mode', icon: 'moon-outline' },
];

export default function AppearanceScreen() {
  const { preference, setPreference, colors, accent } = useTheme();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const premium = useAsync(() => getPremiumStatus(), []);
  const [saving, setSaving] = useState<string | null>(null);

  const choose = (id: ThemePreference) => {
    setPreference(id);
    patchSettings({ theme: id });
    if (user) updateMySettings(user.id, { theme: id }).catch(() => undefined);
  };

  const chooseAccent = async (id: string) => {
    if (!user) return;
    if (id !== 'default' && premium.data && !premium.data.is_premium) {
      router.navigate('/premium' as never);
      return;
    }
    setSaving(id);
    try {
      await updateMySettings(user.id, { accent: id });
      patchSettings({ accent: id });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Screen header={<ScreenHeader title="Appearance" fallbackHref="/settings" />} scroll>
      <Text variant="body" color="textMuted" style={{ marginVertical: spacing.lg }}>
        Friendzy mixes light and dark surfaces by design: messaging, video and LIVE always use the dark theme, while discovery, profiles and settings follow your preference.
      </Text>
      <View style={styles.options}>
        {OPTIONS.map((o) => {
          const selected = preference === o.id;
          return (
            <Pressable key={o.id} onPress={() => choose(o.id)} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.option, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface }]}>
              <View style={[styles.preview, { backgroundColor: o.id === 'dark' ? palette.night : o.id === 'light' ? palette.white : palette.lavender, borderColor: colors.border }]}>
                <View style={[styles.previewBar, { backgroundColor: colors.primary }]} />
                <View style={[styles.previewLine, { backgroundColor: o.id === 'dark' ? palette.night3 : palette.lavenderDeep }]} />
                <View style={[styles.previewLine, { width: '50%', backgroundColor: o.id === 'dark' ? palette.night3 : palette.lavenderDeep }]} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text variant="bodySemibold">{o.label}</Text>
                <Text variant="small" color="textMuted">
                  {o.description}
                </Text>
              </View>
              <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing['2xl'], marginBottom: spacing.sm }}>
        <Text variant="h4" style={{ flex: 1 }}>
          Accent themes
        </Text>
        {premium.data && !premium.data.is_premium ? <Button title="Premium" size="sm" variant="ghost" leftIcon="diamond-outline" onPress={() => router.navigate('/premium' as never)} /> : null}
      </View>
      <Text variant="small" color="textMuted" style={{ marginBottom: spacing.md }}>
        Changes buttons, highlights and glows across the app. Exclusive accents are a Friendzy Premium perk.
      </Text>
      <View style={styles.accents}>
        {ACCENTS.map((a) => {
          const selected = accent === a.id;
          const locked = a.id !== 'default' && Boolean(premium.data) && !premium.data!.is_premium;
          return (
            <Pressable key={a.id} onPress={() => void chooseAccent(a.id)} disabled={saving !== null} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.accent, { borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.surface }]}>
              <LinearGradient colors={[...a.colors]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swatch} />
              <Text variant="smallMedium">{a.label}</Text>
              {locked ? <Ionicons name="lock-closed" size={12} color={colors.textMuted} style={styles.lock} /> : selected ? <Ionicons name="checkmark-circle" size={16} color={colors.primary} style={styles.lock} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { gap: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5 },
  preview: { width: 64, height: 48, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, padding: 6, justifyContent: 'flex-start', gap: 5 },
  previewBar: { height: 6, width: '70%', borderRadius: 3 },
  previewLine: { height: 5, width: '80%', borderRadius: 3 },
  accents: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing['3xl'] },
  accent: { width: 104, alignItems: 'center', padding: spacing.sm, borderRadius: radius.md, borderWidth: 1.5 },
  swatch: { width: 72, height: 40, borderRadius: radius.sm, marginBottom: spacing.xs },
  lock: { position: 'absolute', top: 6, right: 6 },
});
