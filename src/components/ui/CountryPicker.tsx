import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { COUNTRIES, flagEmoji, getCountry } from '@/constants/countries';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';

export interface CountryPickerProps {
  value: string | null;
  onChange: (code: string) => void;
  label?: string;
  error?: string | null;
  placeholder?: string;
  allowClear?: boolean;
}

export function CountryPicker({ value, onChange, label = 'Country', error, placeholder = 'Choose your country', allowClear = false }: CountryPickerProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = getCountry(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  }, [query]);

  return (
    <View>
      {label ? (
        <Text variant="smallMedium" color="textSecondary" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[styles.trigger, { backgroundColor: colors.inputBackground, borderColor: error ? palette.danger : colors.border }]}
      >
        <Text variant="body" style={{ marginRight: spacing.sm }}>
          {selected ? flagEmoji(selected.code) : '🌍'}
        </Text>
        <Text variant="body" color={selected ? 'text' : 'placeholder'} style={styles.triggerText} numberOfLines={1}>
          {selected ? selected.name : placeholder}
        </Text>
        {allowClear && selected ? (
          <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear country">
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        )}
      </Pressable>
      {error ? (
        <Text variant="small" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="Select country" maxHeightFraction={0.85}>
        <Input placeholder="Search countries" leftIcon="search-outline" value={query} onChangeText={setQuery} autoFocus autoCorrect={false} />
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.code}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          renderItem={({ item }) => {
            const isSelected = item.code === value;
            return (
              <Pressable
                onPress={() => {
                  onChange(item.code);
                  setOpen(false);
                  setQuery('');
                }}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.row,
                  (pressed || hovered) && { backgroundColor: colors.surfaceMuted },
                  isSelected && { backgroundColor: colors.primarySoft },
                ]}
              >
                <Text variant="bodyLg" style={{ marginRight: spacing.md }}>
                  {flagEmoji(item.code)}
                </Text>
                <Text variant="body" style={styles.rowText}>
                  {item.name}
                </Text>
                {isSelected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text variant="body" color="textMuted" align="center" style={{ paddingVertical: spacing['2xl'] }}>
              No countries match “{query}”.
            </Text>
          }
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: spacing.sm },
  trigger: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.lg },
  triggerText: { flex: 1 },
  error: { marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  list: { marginTop: spacing.md, maxHeight: 420 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  rowText: { flex: 1 },
});
