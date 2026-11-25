import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Pill, VerifiedBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { LOOKING_FOR_OPTIONS } from '@/constants/interests';
import { languageNames } from '@/constants/languages';
import { MatchPreferencesSheet, describePrefs, prefsFromSettings } from '@/features/discover/MatchPreferencesSheet';
import { MatchSearching } from '@/features/discover/MatchSearching';
import { personMeta, pluralize, presenceLabel } from '@/features/discover/presence';
import { confirmAction } from '@/features/feed/usePostActions';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { matchFind, matchLeave, sendMatchAction, subscribeToMatchQueue } from '@/services/discovery';
import { useAuth } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { gradients, palette, radius, shadows, spacing } from '@/theme/tokens';
import type { DiscoverCard, MatchFindResult } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';

type Phase = 'idle' | 'searching' | 'result' | 'empty' | 'error';
type Found = Extract<MatchFindResult, { status: 'matched' | 'suggested' }>;

const POLL_MS = 2500;

function ageFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

export default function MatchScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { user, profile, settings, privateData } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [found, setFound] = useState<Found | null>(null);
  const [requested, setRequested] = useState(false);
  const [search, setSearch] = useState({ waited: 0, searchingNow: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => Promise<void>>(async () => undefined);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = useCallback(async () => {
    if (!active.current) return;
    clearTimer();
    try {
      const result = await matchFind();
      if (!active.current) return;
      if (result.status === 'searching') {
        setSearch({ waited: result.waited_seconds, searchingNow: result.searching_now });
        timer.current = setTimeout(() => void pollRef.current(), POLL_MS);
      } else if (result.status === 'empty') {
        active.current = false;
        setSearch((s) => ({ ...s, waited: result.waited_seconds }));
        setPhase('empty');
        void matchLeave().catch(() => undefined);
      } else {
        active.current = false;
        setFound(result);
        setRequested(false);
        setPhase('result');
      }
    } catch (err) {
      if (!active.current) return;
      active.current = false;
      setError(getErrorMessage(err));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const start = useCallback(() => {
    setError(null);
    setFound(null);
    setRequested(false);
    setSearch({ waited: 0, searchingNow: 0 });
    active.current = true;
    setPhase('searching');
    void poll();
  }, [poll]);

  const stop = useCallback(async (nextPhase: Phase = 'idle') => {
    active.current = false;
    clearTimer();
    setPhase(nextPhase);
    await matchLeave().catch(() => undefined);
  }, []);

  // The other side matched with us: refresh immediately instead of waiting for the next poll.
  useEffect(() => {
    if (!user?.id) return;
    return subscribeToMatchQueue(user.id, () => {
      if (active.current) void poll();
    });
  }, [user?.id, poll]);

  // Leaving the screen always leaves the queue — nobody gets matched with an absent person.
  useFocusEffect(
    useCallback(() => {
      return () => {
        active.current = false;
        clearTimer();
        void matchLeave().catch(() => undefined);
      };
    }, []),
  );
  useEffect(() => () => clearTimer(), []);

  const act = async (action: 'skip' | 'friend' | 'chat' | 'block') => {
    if (!found || busy) return;
    const person = found.candidate;
    setBusy(action);
    try {
      const result = await sendMatchAction(person.id, action);
      if (action === 'chat') {
        if (result.conversation_id) router.navigate(`/chat/${result.conversation_id}` as never);
        else toast.info('Conversation requested', 'They will see your message request.');
        setPhase('idle');
        setFound(null);
        return;
      }
      if (action === 'friend') {
        setRequested(true);
        toast.success('Friend request sent', `We let ${person.display_name} know you matched.`);
        return;
      }
      if (action === 'block') {
        toast.info(`${person.display_name} is blocked`);
        setPhase('idle');
        setFound(null);
        return;
      }
      start();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const report = () => {
    if (!found) return;
    // Recording the report in matching keeps this person out of your future matches.
    void sendMatchAction(found.candidate.id, 'report').catch(() => undefined);
    setReportOpen(true);
  };

  const prefs = prefsFromSettings(settings);
  const summary = describePrefs(prefs);
  const myAge = ageFromBirthDate(privateData?.birth_date);
  const gated = settings && !settings.random_match_enabled ? 'disabled' : myAge != null && myAge < 18 ? 'minor' : null;

  const renderIdle = () => {
    if (gated === 'disabled') {
      return <EmptyState icon="lock-closed-outline" title="Meet Someone is turned off" description="Turn on Meet Someone in your privacy settings to get matched with people worldwide. You can switch it off again at any time." action={{ title: 'Open privacy settings', onPress: () => router.navigate('/settings/privacy' as never) }} />;
    }
    if (gated === 'minor') {
      return <EmptyState icon="shield-checkmark-outline" title="Available from age 18" description="Meet Someone is for adults only. You can still discover and add friends from the Discover tab." action={{ title: 'Explore Discover', onPress: () => router.navigate('/discover') }} />;
    }
    return (
      <View>
        <View style={[styles.hero, shadows.glow]}>
          <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={72} ring />
          <Text variant="h2" color={palette.white} align="center" style={{ marginTop: spacing.md }}>
            Meet someone
          </Text>
          <Text variant="body" color="rgba(255,255,255,0.9)" align="center" style={{ marginTop: spacing.xs }}>
            Get matched live with a real person who fits your preferences — anywhere in the world. Then you decide: chat, add as a friend, or find someone else.
          </Text>
        </View>

        <View style={[styles.prefsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="h4" style={{ flex: 1 }}>
              Your preferences
            </Text>
            <Button title="Edit" variant="ghost" size="sm" leftIcon="options-outline" onPress={() => setPrefsOpen(true)} />
          </View>
          <View style={styles.wrap}>
            {summary.map((s) => (
              <Chip key={s} label={s} size="sm" disabled style={{ opacity: 1 }} />
            ))}
          </View>
        </View>

        <Button title="Start searching" size="lg" fullWidth leftIcon="shuffle" glow onPress={start} style={{ marginTop: spacing.xl }} />

        <View style={[styles.safety, { backgroundColor: colors.surfaceMuted }]}>
          {[
            ['people-outline', 'Adults only (18+). Everyone you meet is a real Friendzy member who also chose to match.'],
            ['call-outline', 'Nothing starts automatically — no calls, no messages. You choose every next step.'],
            ['shield-checkmark-outline', 'Report or block anyone, anytime. Blocked and skipped people are not shown again.'],
            ['location-outline', 'Your exact location, email and birth date are never shared.'],
          ].map(([icon, text]) => (
            <View key={text} style={styles.safetyRow}>
              <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={colors.primary} />
              <Text variant="small" color="textSecondary" style={{ flex: 1, marginLeft: spacing.sm }}>
                {text}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderResult = (c: DiscoverCard, live: boolean) => {
    const presence = presenceLabel(c.presence);
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.md]}>
        <LinearGradient colors={[...gradients.brand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardTop} />
        <Pill label={live ? 'Live match' : 'Suggested for you'} tone={live ? 'gradient' : 'neutral'} icon={live ? 'flash' : 'sparkles'} style={{ alignSelf: 'center' }} />
        <Pressable onPress={() => router.navigate(`/u/${c.username}` as never)} style={styles.avatarWrap} accessibilityRole="button" accessibilityLabel={`View ${c.display_name}'s profile`}>
          <Avatar uri={c.avatar_url} name={c.display_name} size={120} ring online={c.presence.is_online} />
        </Pressable>
        <View style={styles.nameRow}>
          <Text variant="h2" align="center">
            {c.display_name}
          </Text>
          {c.is_verified ? <VerifiedBadge size={18} style={{ marginLeft: spacing.sm }} /> : null}
        </View>
        <Text variant="body" color="textMuted" align="center">
          {personMeta(c)}
        </Text>
        {presence ? (
          <Text variant="small" color={presence.tone === 'online' ? 'success' : 'textMuted'} align="center" style={{ marginTop: 2 }}>
            {presence.text}
          </Text>
        ) : null}
        <View style={[styles.wrap, { justifyContent: 'center', marginTop: spacing.md }]}>
          {c.shared_interests > 0 ? <Pill label={pluralize(c.shared_interests, 'shared interest')} tone="gradient" icon="sparkles" /> : null}
          {c.mutual_friends > 0 ? <Pill label={pluralize(c.mutual_friends, 'mutual friend')} icon="people" /> : null}
          {c.languages.length > 0 ? <Pill label={`Speaks ${languageNames(c.languages, 2)}`} icon="language" /> : null}
        </View>
        {c.bio ? (
          <Text variant="body" align="center" style={{ marginTop: spacing.lg }}>
            {c.bio}
          </Text>
        ) : null}
        {c.interests.length > 0 ? (
          <View style={[styles.wrap, { justifyContent: 'center', marginTop: spacing.lg }]}>
            {c.interests.slice(0, 8).map((i) => (
              <Chip key={i.id} label={i.name} emoji={i.emoji} size="sm" selected={i.shared} disabled style={{ opacity: 1 }} />
            ))}
          </View>
        ) : null}
        {c.looking_for.length > 0 ? (
          <Text variant="small" color="textMuted" align="center" style={{ marginTop: spacing.md }}>
            Looking for: {c.looking_for.map((id) => LOOKING_FOR_OPTIONS.find((o) => o.id === id)?.label ?? id).join(' · ')}
          </Text>
        ) : null}

        <View style={styles.options}>
          <Button title="Start chatting" size="lg" fullWidth leftIcon="chatbubble-ellipses" glow onPress={() => void act('chat')} loading={busy === 'chat'} disabled={Boolean(busy)} />
          <Button title={requested ? 'Friend request sent' : 'Send friend request'} variant="secondary" size="lg" fullWidth leftIcon={requested ? 'checkmark' : 'person-add-outline'} onPress={() => void act('friend')} loading={busy === 'friend'} disabled={Boolean(busy) || requested} />
          <Button title="Find someone else" variant="outline" size="lg" fullWidth leftIcon="shuffle" onPress={() => void act('skip')} loading={busy === 'skip'} disabled={Boolean(busy)} />
        </View>
        <View style={styles.secondary}>
          <Button title="View profile" variant="ghost" size="sm" onPress={() => router.navigate(`/u/${c.username}` as never)} />
          <Button title="Report" variant="ghost" size="sm" onPress={report} />
          <Button title="Block" variant="ghost" size="sm" onPress={() => confirmAction(`Block ${c.display_name}?`, 'They will not be able to find, match with or contact you.', 'Block', () => void act('block'))} />
        </View>
      </View>
    );
  };

  return (
    <Screen header={<ScreenHeader title="Meet someone" fallbackHref="/discover" right={phase === 'idle' && !gated ? <Button title="Preferences" variant="ghost" size="sm" leftIcon="options-outline" onPress={() => setPrefsOpen(true)} /> : undefined} />} scroll>
      <View style={{ marginTop: spacing.lg }}>
        {phase === 'idle' ? (
          renderIdle()
        ) : phase === 'searching' ? (
          <View>
            <MatchSearching avatarUrl={profile?.avatar_url ?? null} name={profile?.display_name ?? 'You'} waited={search.waited} searchingNow={search.searchingNow} />
            <View style={[styles.wrap, { justifyContent: 'center' }]}>
              {summary.map((s) => (
                <Chip key={s} label={s} size="sm" disabled style={{ opacity: 1 }} />
              ))}
            </View>
            <Button title="Cancel" variant="secondary" fullWidth onPress={() => void stop('idle')} style={{ marginTop: spacing['2xl'] }} />
          </View>
        ) : phase === 'result' && found ? (
          renderResult(found.candidate, found.status === 'matched')
        ) : phase === 'empty' ? (
          <EmptyState
            emoji="🌍"
            title="Nobody available right now"
            description={`We searched for ${search.waited >= 60 ? `${Math.round(search.waited / 60)} min` : `${search.waited}s`} and found no one who fits both your preferences and theirs at the moment. Widen your preferences or try again in a little while — new members join every day.`}
            action={{ title: 'Search again', onPress: start, leftIcon: 'refresh' }}
            secondaryAction={{ title: 'Widen preferences', onPress: () => setPrefsOpen(true), leftIcon: 'options-outline' }}
          />
        ) : (
          <EmptyState
            icon={error && /18|Privacy|turned off|restricted/i.test(error) ? 'lock-closed-outline' : 'cloud-offline-outline'}
            title={error && /turned off/i.test(error) ? 'Meet Someone is off' : error && /18/.test(error) ? 'Available from age 18' : error && /restricted/i.test(error) ? 'Matching is paused' : 'Something went wrong'}
            description={error ?? undefined}
            action={error && /turned off/i.test(error) ? { title: 'Privacy settings', onPress: () => router.navigate('/settings/privacy' as never) } : { title: 'Try again', onPress: start, variant: 'secondary' }}
            secondaryAction={{ title: 'Back to Discover', onPress: () => router.navigate('/discover') }}
          />
        )}
      </View>

      <MatchPreferencesSheet visible={prefsOpen} onClose={() => setPrefsOpen(false)} />
      {found ? (
        <ReportSheet
          visible={reportOpen}
          onClose={() => {
            setReportOpen(false);
            setPhase('idle');
            setFound(null);
          }}
          targetType="profile"
          targetId={found.candidate.id}
          targetLabel="profile"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius['2xl'], padding: spacing['2xl'], alignItems: 'center', overflow: 'hidden' },
  prefsCard: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginTop: spacing.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  safety: { borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.xl, gap: spacing.sm },
  safetyRow: { flexDirection: 'row', alignItems: 'flex-start' },
  card: { borderRadius: radius['2xl'], borderWidth: StyleSheet.hairlineWidth, padding: spacing['2xl'], overflow: 'hidden' },
  cardTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 110 },
  avatarWrap: { alignSelf: 'center', marginTop: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  options: { gap: spacing.sm, marginTop: spacing['2xl'] },
  secondary: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
});
