import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AuthShell } from '@/features/auth/AuthShell';
import { signInWithEmail } from '@/services/account';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { signInSchema, zodFieldErrors } from '@/utils/validation';

export default function SignInScreen() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const submit = async () => {
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setUnconfirmed(false);
    setBusy(true);
    try {
      await signInWithEmail(parsed.data.email, parsed.data.password);
      // The auth store flips to signedIn and the (auth) layout redirects into the app.
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'email_not_confirmed') setUnconfirmed(true);
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue to Friendzy."
      footer={
        <View style={styles.footer}>
          <Text variant="body" color="textMuted">
            New to Friendzy?{' '}
          </Text>
          <Link href="/sign-up" asChild>
            <Pressable accessibilityRole="link">
              <Text variant="bodySemibold" color="primary">
                Create an account
              </Text>
            </Pressable>
          </Link>
        </View>
      }
    >
      <Input
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        leftIcon="mail-outline"
        returnKeyType="next"
      />
      <Input
        label="Password"
        placeholder="Your password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        leftIcon="lock-closed-outline"
        containerStyle={{ marginTop: spacing.lg }}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <View style={styles.forgotRow}>
        <Link href="/forgot-password" asChild>
          <Pressable accessibilityRole="link" hitSlop={6}>
            <Text variant="smallMedium" color="primary">
              Forgot password?
            </Text>
          </Pressable>
        </Link>
      </View>
      {unconfirmed ? (
        <Pressable
          onPress={() => router.push({ pathname: '/verify-email', params: { email } })}
          style={styles.unconfirmed}
          accessibilityRole="button"
        >
          <Text variant="small" color="warning">
            {"Your email isn't verified yet. Tap here to resend the verification email."}
          </Text>
        </Pressable>
      ) : null}
      <Button title="Sign in" size="lg" fullWidth onPress={submit} loading={busy} style={{ marginTop: spacing['2xl'] }} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  forgotRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  unconfirmed: { marginTop: spacing.md },
});
