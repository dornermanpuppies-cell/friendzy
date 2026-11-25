import { Redirect, Stack } from 'expo-router';

import { useAuthStore } from '@/store/authStore';

/** Sign-in / sign-up flows. Signed-in users are sent to the app. */
export default function AuthLayout() {
  const status = useAuthStore((s) => s.status);
  if (status === 'signedIn') return <Redirect href="/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
