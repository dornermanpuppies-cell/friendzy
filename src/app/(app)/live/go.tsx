import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { ListItem } from '@/components/ui/ListItem';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { createLive, getMyLives, uploadLiveCover } from '@/services/live';
import { pickImage } from '@/services/media';
import { useAuth } from '@/store/authStore';
import { ThemeScope, useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { LIVE_CATEGORIES, type LiveCategory } from '@/types/live';
import type { PostAudience, StoryAudience } from '@/types/social';
import { getErrorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/format';

function parseSchedule(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || !t) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 2 * 60 * 1000) return null;
  return d.toISOString();
}

export default function GoLiveScreen() {
  const { user, privateData } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<LiveCategory>('chat');
  const [cover, setCover] = useState<{ uri: string } | null>(null);
  const [visibility, setVisibility] = useState<PostAudience>('public');
  const [allowGuests, setAllowGuests] = useState(true);
  const [allowComments, setAllowComments] = useState(true);
  const [commentAudience, setCommentAudience] = useState<StoryAudience>('everyone');
  const [schedule, setSchedule] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = useAsync(() => getMyLives(10), []);

  const birth = privateData?.birth_date ? new Date(privateData.birth_date) : null;
  const age = birth ? Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const underage = age !== null && age < 18;
  const active = mine.data?.find((l) => l.status === 'live' || l.status === 'preparing');

  const submit = async () => {
    if (!user) return;
    if (!title.trim()) {
      toast.error('Give your live a title');
      return;
    }
    const scheduledAt = schedule ? parseSchedule(date, time) : null;
    if (schedule && !scheduledAt) {
      toast.error('Enter a valid future date (YYYY-MM-DD) and time (HH:MM)');
      return;
    }
    setBusy(true);
    try {
      const coverUrl = cover ? await uploadLiveCover(user.id, cover.uri) : null;
      const live = await createLive({ title: title.trim(), category, cover_url: coverUrl, visibility, scheduled_at: scheduledAt, allow_guests: allowGuests, allow_comments: allowComments, comment_audience: commentAudience });
      router.replace(`/live/${live.id}` as never);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemeScope scheme="dark">
      <Screen header={<ScreenHeader title="Go LIVE" fallbackHref="/live" />} scroll padded keyboardAvoiding backgroundColor={palette.night}>
        {underage ? (
          <View style={[styles.notice, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
            <Ionicons name="information-circle" size={20} color={palette.warning} />
            <Text variant="small" color={palette.warning} style={{ marginLeft: spacing.sm, flex: 1 }}>
              Hosting live broadcasts is available from age 18. You can still watch and take part in lives.
            </Text>
          </View>
        ) : null}
        {active ? (
          <Pressable onPress={() => router.navigate(`/live/${active.id}` as never)} style={[styles.notice, { backgroundColor: 'rgba(255,40,185,0.15)' }]}>
            <Ionicons name="radio" size={20} color={palette.pink} />
            <Text variant="small" color={palette.white} style={{ marginLeft: spacing.sm, flex: 1 }}>
              You have a broadcast in progress: “{active.title}”. Tap to return to it.
            </Text>
            <Ionicons name="chevron-forward" size={18} color={palette.white} />
          </Pressable>
        ) : null}

        <View style={{ flexDirection: 'row', marginTop: spacing.lg }}>
          <Pressable onPress={async () => { try { const img = await pickImage('cover'); if (img) setCover({ uri: img.uri }); } catch (e) { toast.error(getErrorMessage(e)); } }} style={[styles.cover, { borderColor: colors.border }]} accessibilityLabel="Choose a cover image">
            {cover ? <Image source={{ uri: cover.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
              <>
                <Ionicons name="image-outline" size={26} color={colors.textMuted} />
                <Text variant="caption" color="textMuted" align="center">
                  Cover
                </Text>
              </>
            )}
          </Pressable>
          <Input placeholder="What's your live about?" value={title} onChangeText={setTitle} maxLength={80} showCounter multiline containerStyle={{ flex: 1, marginLeft: spacing.md }} style={{ minHeight: 96 }} />
        </View>

        <Text variant="label" color="textMuted" style={styles.label}>
          Category
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrap}>
          {LIVE_CATEGORIES.map((c) => (
            <Chip key={c.id} label={c.label} emoji={c.emoji} size="sm" selected={category === c.id} onPress={() => setCategory(c.id)} />
          ))}
        </ScrollView>

        <Text variant="label" color="textMuted" style={styles.label}>
          Who can watch
        </Text>
        <View style={styles.wrap}>
          {(['public', 'followers', 'friends'] as PostAudience[]).map((a) => (
            <Chip key={a} label={a === 'public' ? 'Everyone' : a === 'followers' ? 'Followers' : 'Friends'} size="sm" selected={visibility === a} onPress={() => setVisibility(a)} />
          ))}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <ListItem icon="people-outline" title="Allow guests on stage" subtitle="Viewers can request to join; you approve" switchValue={allowGuests} onSwitchChange={setAllowGuests} />
          <ListItem icon="chatbubbles-outline" title="Allow comments" switchValue={allowComments} onSwitchChange={setAllowComments} />
          {allowComments ? (
            <View style={[styles.wrap, { marginLeft: spacing['4xl'], marginBottom: spacing.sm }]}>
              {(['everyone', 'followers', 'friends'] as StoryAudience[]).map((a) => (
                <Chip key={a} label={a === 'everyone' ? 'Everyone' : a === 'followers' ? 'Followers' : 'Friends'} size="sm" selected={commentAudience === a} onPress={() => setCommentAudience(a)} />
              ))}
            </View>
          ) : null}
          <ListItem icon="calendar-outline" title="Schedule for later" subtitle="Followers get notified now and reminded at start" switchValue={schedule} onSwitchChange={setSchedule} />
          {schedule ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginLeft: spacing['4xl'] }}>
              <Input placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} containerStyle={{ flex: 1 }} autoCapitalize="none" helper={`Today: ${formatDate(new Date(), 'yyyy-MM-dd')}`} />
              <Input placeholder="HH:MM" value={time} onChangeText={setTime} containerStyle={{ width: 110 }} autoCapitalize="none" />
            </View>
          ) : null}
        </View>

        <Button title={schedule ? 'Schedule live' : 'Continue to preview'} leftIcon={schedule ? 'calendar-outline' : 'radio-outline'} onPress={() => void submit()} loading={busy} disabled={underage || Boolean(active)} glow fullWidth style={{ marginTop: spacing['2xl'] }} />
        <Text variant="caption" color="textMuted" align="center" style={{ marginTop: spacing.md, marginBottom: spacing['2xl'] }}>
          By going live you agree to the Community Guidelines. Broadcasts are moderated and may be ended for violations.
        </Text>

        {mine.data && mine.data.some((l) => l.status === 'scheduled') ? (
          <View style={{ marginBottom: spacing['3xl'] }}>
            <Text variant="h4" color={palette.white} style={{ marginBottom: spacing.sm }}>
              Your scheduled lives
            </Text>
            {mine.data.filter((l) => l.status === 'scheduled').map((l) => (
              <ListItem key={l.id} icon="time-outline" title={l.title} subtitle={formatDate(l.scheduled_at, 'EEE d MMM, HH:mm')} onPress={() => router.navigate(`/live/${l.id}` as never)} />
            ))}
          </View>
        ) : null}
      </Screen>
    </ThemeScope>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, marginTop: spacing.lg },
  cover: { width: 96, height: 96, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: palette.night2 },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
