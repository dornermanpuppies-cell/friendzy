import { useLocalSearchParams } from 'expo-router';

import { LiveRoom } from '@/features/live/LiveRoom';
import { ThemeScope } from '@/theme/ThemeProvider';

export default function LiveRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ThemeScope scheme="dark">
      <LiveRoom liveId={String(id)} />
    </ThemeScope>
  );
}
