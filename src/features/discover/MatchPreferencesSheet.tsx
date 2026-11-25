import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { CountryPicker } from '@/components/ui/CountryPicker';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { countryName, flagEmoji } from '@/constants/countries';
import { languageName } from '@/constants/languages';
import { updateMySettings } from '@/services/profiles';
import { useAuth, useAuthStore } from '@/store/authStore';
import { spacing } from '@/theme/tokens';
import type { UserSettingsRow } from '@/types/database';
import { getErrorMessage } from '@/utils/errors';

import { LanguagePickerSheet } from './LanguagePickerSheet';

export type MatchPrefs = Pick<UserSettingsRow, 'match_countries' | 'match_languages' | 'match_genders' | 'preferred_min_age' | 'preferred_max_age' | 'match_shared_interests'>;

export const GENDER_OPTIONS = [
  { id: 'woman', label: 'Women' },
  { id: 'man', label: 'Men' },
  { id: 'non_binary', label: 'Non-binary' },
  { id: 'other', label: 'Other' },
];

export function prefsFromSettings(settings: UserSettingsRow | null): MatchPrefs {
  return {
    match_countries: settings?.match_countries ?? [],
    match_languages: settings?.match_languages ?? [],
    match_genders: settings?.match_genders ?? [],
    preferred_min_age: settings?.preferred_min_age ?? null,
    preferred_max_age: settings?.preferred_max_age ?? null,
    match_shared_interests: settings?.match_shared_interests ?? false,
  };
}

/** Short human summary, e.g. ["Worldwide", "Any language", "Ages 18+"]. */
export function describePrefs(p: MatchPrefs): string[] {
  const out: string[] = [];
  out.push(p.match_countries.length === 0 ? 'Worldwide' : p.match_countries.length === 1 ? `${flagEmoji(p.match_countries[0])} ${countryName(p.match_countries[0])}` : `${p.match_countries.length} countries`);
  out.push(p.match_languages.length === 0 ? 'Any language' : p.match_languages.length <= 2 ? p.match_languages.map(languageName).join(', ') : `${p.match_languages.length} languages`);
  out.push(p.match_genders.length === 0 ? 'Everyone' : p.match_genders.map((g) => GENDER_OPTIONS.find((o) => o.id === g)?.label ?? g).join(', '));
  if (p.preferred_min_age != null || p.preferred_max_age != null) out.push(`Ages ${p.preferred_min_age ?? 18}–${p.preferred_max_age ?? '99+'}`);
  else out.push('Ages 18+');
  if (p.match_shared_interests) out.push('Shared interests only');
  return out;
}

export function MatchPreferencesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, settings } = useAuth();
  const patchSettings = useAuthStore((s) => s.patchSettings);
  const toast = useToast();
  const [draft, setDraft] = useState<MatchPrefs>(() => prefsFromSettings(settings));
  const [synced, setSynced] = useState(visible);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed the draft from settings each time the sheet opens (no effect needed).
  if (visible !== synced) {
    setSynced(visible);
    if (visible) setDraft(prefsFromSettings(settings));
  }

  const save = async () => {
    if (!user) return;
    const min = draft.preferred_min_age;
    const max = draft.preferred_max_age;
    if (min != null && max != null && min > max) {
      toast.error('The minimum age cannot be higher than the maximum.');
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<UserSettingsRow> = {
        match_countries: draft.match_countries,
        match_languages: draft.match_languages,
        match_genders: draft.match_genders,
        preferred_min_age: min,
        preferred_max_age: max,
        match_shared_interests: draft.match_shared_interests,
      };
      await updateMySettings(user.id, patch);
      patchSettings(patch);
      toast.success('Preferences saved');
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const clampAge = (v: string, fallback: number) => (v ? Math.max(18, Math.min(99, Number(v) || fallback)) : null);

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Match preferences"
        subtitle="Preferences work both ways — you are only matched with people whose preferences also include you."
        maxHeightFraction={0.92}
        footer={
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <Button title="Reset" variant="ghost" onPress={() => setDraft({ match_countries: [], match_languages: [], match_genders: [], preferred_min_age: null, preferred_max_age: null, match_shared_interests: false })} />
            <Button title="Save preferences" onPress={save} loading={saving} style={{ flex: 1 }} />
          </View>
        }
      >
        <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text variant="label" color="textMuted" style={styles.label}>
            Countries
          </Text>
          <View style={styles.wrap}>
            {draft.match_countries.map((code) => (
              <Chip key={code} label={`${flagEmoji(code)} ${countryName(code)}`} size="sm" selected icon="close" onPress={() => setDraft({ ...draft, match_countries: draft.match_countries.filter((c) => c !== code) })} />
            ))}
            {draft.match_countries.length === 0 ? <Chip label="🌍 Worldwide" size="sm" selected disabled style={{ opacity: 1 }} /> : null}
          </View>
          <View style={{ marginTop: spacing.sm }}>
            <CountryPicker value={null} label="" placeholder="Add a country" onChange={(code) => (code && !draft.match_countries.includes(code) && draft.match_countries.length < 30 ? setDraft({ ...draft, match_countries: [...draft.match_countries, code] }) : undefined)} />
          </View>

          <Text variant="label" color="textMuted" style={styles.label}>
            Languages
          </Text>
          <View style={styles.wrap}>
            {draft.match_languages.map((code) => (
              <Chip key={code} label={languageName(code)} size="sm" selected icon="close" onPress={() => setDraft({ ...draft, match_languages: draft.match_languages.filter((c) => c !== code) })} />
            ))}
            <Chip label={draft.match_languages.length ? 'Add language' : 'Any language · add'} icon="add" size="sm" onPress={() => setLanguagesOpen(true)} />
          </View>

          <Text variant="label" color="textMuted" style={styles.label}>
            Gender
          </Text>
          <View style={styles.wrap}>
            {GENDER_OPTIONS.map((g) => {
              const on = draft.match_genders.includes(g.id);
              return <Chip key={g.id} label={g.label} size="sm" selected={on} onPress={() => setDraft({ ...draft, match_genders: on ? draft.match_genders.filter((x) => x !== g.id) : [...draft.match_genders, g.id] })} />;
            })}
          </View>
          <Text variant="caption" color="textMuted" style={{ marginTop: spacing.xs }}>
            Leave empty to meet everyone. A gender preference only matches people who chose to show their gender.
          </Text>

          <Text variant="label" color="textMuted" style={styles.label}>
            Age range (18+)
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Input placeholder="Min 18" keyboardType="number-pad" value={draft.preferred_min_age?.toString() ?? ''} onChangeText={(v) => setDraft({ ...draft, preferred_min_age: clampAge(v, 18) })} containerStyle={{ flex: 1 }} />
            <Input placeholder="Max 99" keyboardType="number-pad" value={draft.preferred_max_age?.toString() ?? ''} onChangeText={(v) => setDraft({ ...draft, preferred_max_age: clampAge(v, 99) })} containerStyle={{ flex: 1 }} />
          </View>

          <ListItem icon="sparkles-outline" title="Shared interests only" subtitle="Only match people with at least one interest in common" switchValue={draft.match_shared_interests} onSwitchChange={(v) => setDraft({ ...draft, match_shared_interests: v })} style={{ marginTop: spacing.lg, marginBottom: spacing.lg }} />
        </ScrollView>
      </Sheet>
      <LanguagePickerSheet visible={languagesOpen} onClose={() => setLanguagesOpen(false)} value={draft.match_languages} onChange={(codes) => setDraft({ ...draft, match_languages: codes })} max={10} title="Match languages" subtitle="Meet people who speak…" />
    </>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
