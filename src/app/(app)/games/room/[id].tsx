import { useLocalSearchParams } from 'expo-router';

import { GameRoomScreen } from '@/features/games/GameRoomScreen';

export default function GameRoomRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GameRoomScreen roomId={String(id)} />;
}
