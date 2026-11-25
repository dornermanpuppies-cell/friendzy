import { Stack } from 'expo-router';

/** Public website pages (about, features, legal, help). Accessible signed in or out. */
export default function MarketingGroupLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
