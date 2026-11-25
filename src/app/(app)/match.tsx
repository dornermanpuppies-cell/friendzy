import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Pill, VerifiedBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { countryName, flagEmoji } from '@/constants/countries';
import { LOOKING_FOR_OPTIONS } from '@/constants/interests';
import { useAsync } from '@/hooks/useAsync';
import { getMatchCandidate, sendMatchAction } from '@/services/discovery';
import { startDirectConversation } from '@/services/messaging';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

export default function MatchScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const candidate = useAsync(() => getMatchCandidate(), [round]);
  const c = candidate.data;

  const act = async (action: 'skip' | 'friend' | 'chat' | 'block') => {
    if (!c || busy) return;
    setBusy(true);
    try {
      const result = await sendMatchAction(c.profile.id, action);
      if (action === 'friend') toast.success('Friend request sent', `We let ${c.profile.display_name} know you matched.`);
      if (action === 'block') toast.info('Blocked');
      if (action === 'chat') {
        const conversationId = await startDirectConversation(c.profile.id);
        router.navigate(`/chat/${conversationId}` as never);
        return;
      }
      void result;
      setRound((r) => r + 1);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const errorIsGate = candidate.error && /18|Random matching|Settings/.test(candidate.error);

  return (
    <Screen header={<ScreenHeader title="Random match" fallbackHref="/discover" />} scroll>
      <Text variant="body" color="textMuted" style={{ marginTop: spacing.md }}>
        Meet someone new who shares your interests. Skip anytime — people are never shown your exact location.
      </Text>
      <View style={{ marginTop: spacing.xl }}>
        {candidate.loading ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Skeleton circle height={120} style={{ alignSelf: 'center' }} />
            <Skeleton width="50%" height={22} style={{ alignSelf: 'center', marginTop: spacing.lg }} />
            <Skeleton width="30%" height={14} style={{ alignSelf: 'center', marginTop: spacing.sm }} />
            <Skeleton height={60} style={{ marginTop: spacing.lg }} />
          </View>
        ) : candidate.error ? (
          <EmptyState
            icon={errorIsGate ? 'lock-closed-outline' : 'cloud-offline-outline'}
            title={errorIsGate ? 'Matching is not available' : 'Something went wrong'}
            description={candidate.error}
            action={errorIsGate ? { title: 'Privacy settings', onPress: () => router.navigate('/settings/privacy' as never), variant: 'secondary' } : { title: 'Try again', onPress: candidate.reload, variant: 'secondary' }}
          />
        ) : !c ? (
          <EmptyState
            emoji="🌍"
            title="No new people right now"
            description="You've seen everyone who matches for now. Check back soon — new members join every day."
            action={{ title: 'Refresh', onPress: () => setRound((r) => r + 1), variant: 'secondary' }}
            secondaryAction={{ title: 'Explore Discover', onPress: () => router.navigate('/discover') }}
          />
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.md]}>
            <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardTop} />
            <View style={styles.avatarWrap}>
              <Avatar uri={c.profile.avatar_url} name={c.profile.display_name} size={120} ring />
            </View>
            <View style={styles.nameRow}>
              <Text variant="h2" align="center">
                {c.profile.display_name}
              </Text>
              {c.profile.is_verified ? <VerifiedBadge size={18} style={{ marginLeft: spacing.sm }} /> : null}
            </View>
            <Text variant="body" color="textMuted" align="center">
              @{c.profile.username}
              {c.profile.country_code ? ` · ${flagEmoji(c.profile.country_code)} ${countryName(c.profile.country_code)}` : ''}
            </Text>
            {c.shared_interests > 0 ? <Pill label={`${c.shared_interests} shared interest${c.shared_interests === 1 ? '' : 's'}`} tone="gradient" icon="sparkles" style={{ alignSelf: 'center', marginTop: spacing.md }} /> : null}
            {c.profile.bio ? (
              <Text variant="body" align="center" style={{ marginTop: spacing.lg }}>
                {c.profile.bio}
              </Text>
            ) : null}
            {c.interests.length > 0 ? (
              <View style={styles.chips}>
                {c.interests.slice(0, 8).map((i) => (
                  <Chip key={i.id} label={i.name} emoji={i.emoji} size="sm" disabled />
                ))}
              </View>
            ) : null}
            {c.looking_for.length > 0 ? (
              <Text variant="small" color="textMuted" align="center" style={{ marginTop: spacing.md }}>
                Looking for: {c.looking_for.map((id) => LOOKING_FOR_OPTIONS.find((o) => o.id === id)?.label ?? id).join(' · ')}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable onPress={() => act('skip')} disabled={busy} style={[styles.roundBtn, { backgroundColor: colors.surfaceMuted }]} accessibilityLabel="Skip">
                <Ionicons name="close" size={28} color={colors.textSecondary} />
              </Pressable>
              <Pressable onPress={() => act('friend')} disabled={busy} style={[styles.roundBtn, styles.primaryBtn]} accessibilityLabel="Send friend request">
                <LinearGradient colors={[...gradients.primary]} style={StyleSheet.absoluteFill} />
                <Ionicons name="person-add" size={28} color={palette.white} />
              </Pressable>
              <Pressable onPress={() => act('chat')} disabled={busy} style={[styles.roundBtn, { backgroundColor: colors.primarySoft }]} accessibilityLabel="Start a conversation">
                <Ionicons name="chatbubble-ellipses" size={26} color={colors.primary} />
              </Pressable>
            </View>
            <View style={styles.secondary}>
              <Button title="View profile" variant="ghost" size="sm" onPress={() => router.navigate(`/u/${c.profile.username}` as never)} />
              <Button title="Report" variant="ghost" size="sm" onPress={() => setReportOpen(true)} />
              <Button title="Block" variant="ghost" size="sm" onPress={() => act('block')} />
            </View>
          </View>
        )}
      </View>
      {c ? <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} targetType="profile" targetId={c.profile.id} targetLabel="profile" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius['2xl'], borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'], overflow: 'hidden' },
  cardTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 96 },
  avatarWrap: { alignSelf: 'center', marginTop: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
  actions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing['2xl'], marginTop: spacing['2xl'] },
  roundBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  primaryBtn: { width: 76, height: 76, borderRadius: 38 },
  secondary: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
});
