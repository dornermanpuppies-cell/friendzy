import { Ionicons } from '@/components/ui/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { LANGUAGES, MAX_LANGUAGES, languageName } from '@/constants/languages';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export interface LanguagePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  value: string[];
  onChange: (codes: string[]) => void;
  max?: number;
  title?: string;
  subtitle?: string;
}

/** Multi-select list of spoken languages with search. */
export function LanguagePickerSheet({ visible, onClose, value, onChange, max = MAX_LANGUAGES, title = 'Languages you speak', subtitle }: LanguagePickerSheetProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter((l) => l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code === q);
  }, [query]);

  const toggle = (code: string) => {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code));
      return;
    }
    if (value.length >= max) {
      toast.info(`You can pick up to ${max} languages`);
      return;
    }
    onChange([...value, code]);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle ?? `Choose up to ${max}`} maxHeightFraction={0.88} footer={<Button title="Done" fullWidth onPress={onClose} style={{ marginBottom: spacing.md }} />}>
      {value.length > 0 ? (
        <View style={styles.selected}>
          {value.map((code) => (
            <Chip key={code} label={languageName(code)} size="sm" selected onPress={() => toggle(code)} icon="close" />
          ))}
        </View>
      ) : null}
      <Input placeholder="Search languages" leftIcon="search-outline" value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.code}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={24}
        renderItem={({ item }) => {
          const on = value.includes(item.code);
          return (
            <Pressable onPress={() => toggle(item.code)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, (pressed || hovered) && { backgroundColor: colors.surfaceMuted }, on && { backgroundColor: colors.primarySoft }]}>
              <View style={{ flex: 1 }}>
                <Text variant="body">{item.name}</Text>
                <Text variant="caption" color="textMuted">
                  {item.native}
                </Text>
              </View>
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.primary : colors.textMuted} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text variant="body" color="textMuted" align="center" style={{ paddingVertical: spacing['2xl'] }}>
            No languages match “{query}”.
          </Text>
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  selected: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  list: { marginTop: spacing.md, maxHeight: 400 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radius.md },
});
