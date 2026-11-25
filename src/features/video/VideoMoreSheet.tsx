import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';

import { ListItem } from '@/components/ui/ListItem';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { ReportSheet } from '@/features/profile/ReportSheet';
import { spacing } from '@/theme/tokens';
import type { VideoCard } from '@/types/video';

import { useVideoActions } from './useVideoActions';

function confirm(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}

export function VideoMoreSheet({ video, onClose }: { video: VideoCard | null; onClose: () => void }) {
  const actions = useVideoActions();
  const [report, setReport] = useState<VideoCard | null>(null);
  const v = video;

  const go = (href: string) => {
    onClose();
    router.navigate(href as never);
  };

  return (
    <>
      <Sheet visible={Boolean(v) && !report} onClose={onClose} title="Video options">
        {v ? (
          <>
            <ListItem icon={v.viewer.reposted ? 'repeat' : 'repeat-outline'} title={v.viewer.reposted ? 'Remove repost' : 'Repost'} subtitle="Share this video with your followers" onPress={() => { onClose(); void actions.repost(v); }} showChevron={false} />
            {v.allow_duet && !v.viewer.is_author ? <ListItem icon="people-outline" title="Duet" subtitle="Record side by side with this video" onPress={() => go(`/compose/video?duet=${v.id}`)} showChevron={false} /> : null}
            {v.allow_stitch && !v.viewer.is_author ? <ListItem icon="cut-outline" title="Stitch" subtitle="Use up to 5 seconds of this video in yours" onPress={() => go(`/compose/video?stitch=${v.id}`)} showChevron={false} /> : null}
            <ListItem icon="link-outline" title="Copy link" onPress={() => { onClose(); void actions.copyLink(v); }} showChevron={false} />
            {v.sound ? <ListItem icon="musical-notes-outline" title="Use this sound" subtitle={v.sound.title} onPress={() => go(`/compose/video?sound=${v.sound!.id}`)} showChevron={false} /> : null}
            {v.allow_download && v.media_url ? <ListItem icon="download-outline" title="Download" subtitle="Opens the original file" onPress={() => go(v.media_url!)} showChevron={false} /> : null}
            {!v.viewer.is_author ? (
              <>
                <ListItem icon="eye-off-outline" title="Not interested" subtitle="Show fewer videos like this" onPress={() => { onClose(); void actions.notInterested(v); }} showChevron={false} />
                <ListItem icon="flag-outline" title="Report" danger onPress={() => setReport(v)} showChevron={false} />
              </>
            ) : (
              <>
                <ListItem icon="stats-chart-outline" title="Analytics" onPress={() => go(`/studio?video=${v.id}`)} showChevron={false} />
                <ListItem icon="create-outline" title="Edit details" subtitle="Caption, audience, permissions" onPress={() => go(`/studio?edit=${v.id}`)} showChevron={false} />
                <ListItem icon="trash-outline" title="Delete video" danger onPress={() => confirm('Delete video?', 'This cannot be undone.', () => { onClose(); void actions.destroy(v); })} showChevron={false} />
              </>
            )}
            <Text variant="caption" color="textMuted" style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
              Video id {v.id.slice(0, 8)} · {v.audience === 'public' ? 'Public' : v.audience === 'followers' ? 'Followers only' : 'Friends only'}
            </Text>
          </>
        ) : null}
      </Sheet>
      {report ? <ReportSheet visible onClose={() => { setReport(null); onClose(); }} targetType="video" targetId={report.id} targetLabel="this video" /> : null}
    </>
  );
}
