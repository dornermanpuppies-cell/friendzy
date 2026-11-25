import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { votePoll } from '@/services/posts';
import { usePostStore } from '@/store/postStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, radius, spacing } from '@/theme/tokens';
import type { PostPoll } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { timeAgo } from '@/utils/format';

export function PollView({ postId, poll }: { postId: string; poll: PostPoll }) {
  const { colors } = useTheme();
  const toast = useToast();
  const patch = usePostStore((s) => s.patch);
  const [pending, setPending] = useState<string[]>(poll.my_votes);
  const [busy, setBusy] = useState(false);
  const voted = poll.my_votes.length > 0;
  const showResults = voted || poll.ended;

  const submit = async (optionIds: string[]) => {
    if (busy || poll.ended) return;
    setBusy(true);
    try {
      const updated = await votePoll(postId, optionIds);
      patch(postId, { poll: updated });
      setPending(updated.my_votes);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    if (poll.ended) return;
    if (!poll.multiple) {
      void submit([id]);
      return;
    }
    setPending((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const endsLabel = poll.ended ? 'Final results' : poll.ends_at ? `Ends ${timeAgo(poll.ends_at).replace('ago', '').trim()}` : 'No end date';

  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      {poll.options.map((option) => {
        const pct = poll.total_votes > 0 ? Math.round((option.votes_count / poll.total_votes) * 100) : 0;
        const mine = poll.my_votes.includes(option.id);
        const selected = pending.includes(option.id);
        return (
          <Pressable
            key={option.id}
            onPress={() => toggle(option.id)}
            disabled={poll.ended || busy}
            accessibilityRole="button"
            accessibilityState={{ selected: mine || selected }}
            style={[styles.option, { borderColor: mine || selected ? colors.primary : colors.border, backgroundColor: colors.surfaceMuted }]}
          >
            {showResults ? (
              <LinearGradient
                colors={mine ? [...gradients.primary] : [colors.surfaceStrong, colors.surfaceStrong]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[StyleSheet.absoluteFill, { width: `${Math.max(pct, 2)}%`, opacity: mine ? 0.35 : 1 }]}
              />
            ) : null}
            <Text variant="bodyMedium" style={{ flex: 1 }}>
              {option.text}
            </Text>
            {showResults ? (
              <Text variant="bodySemibold" color={mine ? 'primary' : 'textSecondary'}>
                {pct}%
              </Text>
            ) : poll.multiple ? (
              <View style={[styles.check, { borderColor: selected ? colors.primary : colors.borderStrong, backgroundColor: selected ? colors.primary : 'transparent' }]} />
            ) : null}
          </Pressable>
        );
      })}
      <View style={styles.footer}>
        <Text variant="small" color="textMuted">
          {poll.total_votes} vote{poll.total_votes === 1 ? '' : 's'} · {endsLabel}
        </Text>
        {poll.multiple && !poll.ended ? <Button title={voted ? 'Update vote' : 'Vote'} size="sm" variant="secondary" onPress={() => submit(pending)} disabled={pending.length === 0} loading={busy} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm, marginTop: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, overflow: 'hidden' },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
});
