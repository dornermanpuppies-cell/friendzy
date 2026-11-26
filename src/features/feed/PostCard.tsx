import { Ionicons } from '@/components/ui/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Pill, VerifiedBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { reactionEmoji, type PostCard as PostCardModel } from '@/types/social';
import { formatCount, timeAgo } from '@/utils/format';

import { PollView } from './PollView';
import { PostMedia } from './PostMedia';
import { PostMenuSheet } from './PostMenuSheet';
import { ReactionPicker } from './ReactionPicker';
import { ReactionsSheet } from './ReactionsSheet';
import { RichText } from './RichText';
import { usePostActions } from './usePostActions';

export interface PostCardProps {
  post: PostCardModel;
  active?: boolean;
  /** Detail mode shows the full text and no "open" affordance. */
  detail?: boolean;
  onRemoved?: (id: string) => void;
  onPressComments?: () => void;
  onEdit?: () => void;
}

const AUDIENCE_ICON: Record<PostCardModel['audience'], keyof typeof Ionicons.glyphMap> = { public: 'earth-outline', followers: 'people-outline', friends: 'heart-outline' };

function SharedPostEmbed({ post }: { post: NonNullable<PostCardModel['shared_post']> }) {
  const { colors } = useTheme();
  if ('unavailable' in post && post.unavailable) {
    return (
      <View style={[styles.embed, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
        <Text variant="small" color="textMuted">
          This post is no longer available.
        </Text>
      </View>
    );
  }
  const p = post as PostCardModel;
  const thumb = p.media[0]?.thumbnail_url ?? p.media[0]?.url;
  return (
    <Pressable onPress={() => router.navigate(`/post/${p.id}` as never)} style={[styles.embed, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
      <View style={styles.embedHeader}>
        <Avatar uri={p.author.avatar_url} name={p.author.display_name} size={24} />
        <Text variant="smallMedium" style={{ marginLeft: spacing.sm }} numberOfLines={1}>
          {p.author.display_name}
        </Text>
        <Text variant="small" color="textMuted" style={{ marginLeft: 4 }}>
          @{p.author.username} · {timeAgo(p.created_at)}
        </Text>
      </View>
      {p.text ? (
        <Text variant="small" numberOfLines={4} style={{ marginTop: spacing.xs }}>
          {p.text}
        </Text>
      ) : null}
      {thumb ? <Image source={{ uri: thumb }} style={[styles.embedThumb, { backgroundColor: colors.skeleton }]} contentFit="cover" /> : null}
    </Pressable>
  );
}

function PostCardInner({ post, active = false, detail = false, onRemoved, onPressComments, onEdit }: PostCardProps) {
  const { colors } = useTheme();
  const actions = usePostActions(post, { onRemoved });
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [expanded, setExpanded] = useState(detail);

  const openProfile = () => router.navigate(`/u/${post.author.username}` as never);
  const openComments = onPressComments ?? actions.openDetail;
  const text = post.text ?? '';
  const isLong = text.length > 280;
  const shownText = expanded || !isLong ? text : `${text.slice(0, 280).trimEnd()}…`;
  const reactionLabel = post.viewer.reaction ? reactionEmoji(post.viewer.reaction) : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      {post.reposted_by ? (
        <Pressable onPress={() => router.navigate(`/u/${post.reposted_by!.username}` as never)} style={styles.repostLine}>
          <Ionicons name="repeat" size={14} color={colors.textMuted} />
          <Text variant="caption" color="textMuted" style={{ marginLeft: 6 }}>
            {post.reposted_by.display_name} reposted
          </Text>
        </Pressable>
      ) : null}

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={openProfile} accessibilityRole="button" accessibilityLabel={`${post.author.display_name}'s profile`}>
          <Avatar uri={post.author.avatar_url} name={post.author.display_name} size={44} />
        </Pressable>
        <Pressable onPress={openProfile} style={styles.headerTexts}>
          <View style={styles.nameRow}>
            <Text variant="bodySemibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {post.author.display_name}
            </Text>
            {post.author.is_verified ? <VerifiedBadge size={14} style={{ marginLeft: 4 }} /> : null}
          </View>
          <View style={styles.metaRow}>
            <Text variant="small" color="textMuted" numberOfLines={1}>
              @{post.author.username} · {timeAgo(post.created_at)}
              {post.edited_at ? ' · edited' : ''}
            </Text>
            <Ionicons name={AUDIENCE_ICON[post.audience]} size={12} color={colors.textMuted} style={{ marginLeft: 4 }} />
            {typeof post.distance_km === 'number' ? (
              <Text variant="small" color="textMuted">
                {' '}
                · ~{post.distance_km} km
              </Text>
            ) : null}
          </View>
        </Pressable>
        {!post.viewer.is_author && !post.viewer.following_author ? <Button title="Follow" size="sm" variant="outline" onPress={actions.toggleFollowAuthor} style={{ marginRight: spacing.xs }} /> : null}
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} accessibilityLabel="Post options" style={styles.menuButton}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Body */}
      <Pressable onPress={detail ? undefined : actions.openDetail} disabled={detail} style={styles.body}>
        {post.type === 'question' ? <Pill label="Question" tone="primary" icon="help-circle-outline" style={{ marginBottom: spacing.sm }} /> : null}
        {text ? <RichText text={shownText} variant={detail ? 'bodyLg' : 'body'} /> : null}
        {isLong && !expanded ? (
          <Pressable onPress={() => setExpanded(true)} hitSlop={6}>
            <Text variant="smallMedium" color="primary" style={{ marginTop: 2 }}>
              Read more
            </Text>
          </Pressable>
        ) : null}
      </Pressable>

      {post.media.length > 0 ? (
        <View style={styles.media}>
          <PostMedia media={post.media} active={active} onPressItem={detail ? undefined : () => actions.openDetail()} />
        </View>
      ) : null}
      {post.poll ? (
        <View style={styles.inset}>
          <PollView postId={post.id} poll={post.poll} />
        </View>
      ) : null}
      {post.shared_post ? (
        <View style={styles.inset}>
          <SharedPostEmbed post={post.shared_post} />
        </View>
      ) : null}
      {post.location_name ? (
        <View style={[styles.inset, styles.location]}>
          <Ionicons name="location-outline" size={14} color={colors.textMuted} />
          <Text variant="small" color="textMuted" style={{ marginLeft: 4 }}>
            {post.location_name}
          </Text>
        </View>
      ) : null}

      {/* Counters */}
      {post.likes_count > 0 || post.comments_count > 0 || post.reposts_count > 0 ? (
        <View style={[styles.inset, styles.counters]}>
          <Pressable onPress={() => setReactionsOpen(true)} hitSlop={6}>
            <Text variant="small" color="textMuted">
              {post.likes_count > 0 ? `${reactionLabel ?? '❤️'} ${formatCount(post.likes_count)}` : ''}
            </Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {post.comments_count > 0 ? (
              <Pressable onPress={openComments}>
                <Text variant="small" color="textMuted">
                  {formatCount(post.comments_count)} comment{post.comments_count === 1 ? '' : 's'}
                </Text>
              </Pressable>
            ) : null}
            {post.reposts_count > 0 ? (
              <Text variant="small" color="textMuted">
                {formatCount(post.reposts_count)} repost{post.reposts_count === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Actions */}
      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        <ActionButton
          icon={post.viewer.reaction ? undefined : 'heart-outline'}
          emoji={reactionLabel ?? undefined}
          label={post.viewer.reaction ? post.viewer.reaction[0].toUpperCase() + post.viewer.reaction.slice(1) : 'React'}
          active={Boolean(post.viewer.reaction)}
          onPress={() => actions.react(post.viewer.reaction ? null : 'like')}
          onLongPress={() => setPickerOpen(true)}
        />
        <ActionButton icon="chatbubble-outline" label="Comment" onPress={openComments} disabled={!post.allow_comments} />
        <ActionButton icon="repeat" label={post.viewer.reposted ? 'Reposted' : 'Repost'} active={post.viewer.reposted} activeColor={palette.success} onPress={actions.repost} disabled={post.audience !== 'public'} />
        <ActionButton icon="paper-plane-outline" label="Share" onPress={actions.share} />
        <ActionButton icon={post.viewer.saved ? 'bookmark' : 'bookmark-outline'} label={post.viewer.saved ? 'Saved' : 'Save'} active={post.viewer.saved} onPress={actions.save} />
        <ReactionPicker
          visible={pickerOpen}
          current={post.viewer.reaction}
          onClose={() => setPickerOpen(false)}
          onSelect={(r) => {
            setPickerOpen(false);
            void actions.react(r);
          }}
        />
      </View>

      <PostMenuSheet post={post} visible={menuOpen} onClose={() => setMenuOpen(false)} onRemoved={onRemoved} onEdit={onEdit} />
      <ReactionsSheet postId={post.id} visible={reactionsOpen} onClose={() => setReactionsOpen(false)} />
    </View>
  );
}

function ActionButton({
  icon,
  emoji,
  label,
  active,
  activeColor,
  onPress,
  onLongPress,
  disabled,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  label: string;
  active?: boolean;
  activeColor?: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const color = disabled ? colors.textMuted : active ? (activeColor ?? colors.primary) : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.action, (pressed || hovered) && { backgroundColor: colors.surfaceMuted }, disabled && { opacity: 0.45 }]}
    >
      {emoji ? <Text style={{ fontSize: 18, lineHeight: 22 }}>{emoji}</Text> : <Ionicons name={icon ?? 'ellipse-outline'} size={20} color={color} />}
      <Text variant="caption" style={{ color, marginLeft: 6 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export const PostCard = memo(PostCardInner);

const styles = StyleSheet.create({
  card: { paddingTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  repostLine: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg },
  headerTexts: { flex: 1, marginLeft: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  menuButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null) },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  media: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
  inset: { paddingHorizontal: spacing.lg },
  location: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  counters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginHorizontal: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
  action: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.sm, ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as object) : null) },
  embed: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, marginTop: spacing.md },
  embedHeader: { flexDirection: 'row', alignItems: 'center' },
  embedThumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, marginTop: spacing.sm },
});
