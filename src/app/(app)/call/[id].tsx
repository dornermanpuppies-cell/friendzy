import { useLocalSearchParams } from 'expo-router';

import { CallScreen } from '@/features/calls/CallScreen';

export default function CallRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CallScreen callId={String(id)} />;
}
