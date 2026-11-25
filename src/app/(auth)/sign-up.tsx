import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { CountryPicker } from '@/components/ui/CountryPicker';
import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { AuthShell } from '@/features/auth/AuthShell';
import { APP } from '@/lib/env';
import { signUpWithEmail } from '@/services/account';
import { isUsernameAvailable } from '@/services/profiles';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { GENDER_OPTIONS, normalizeUsername, passwordStrength, signUpSchema, usernameError, zodFieldErrors } from '@/utils/validation';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function SignUpScreen() {
  const toast = useToast();
  const { colors } = useTheme();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [gender, setGender] = useState<string | undefined>(undefined);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [usernameCheck, setUsernameCheck] = useState<{ value: string; available: boolean | null } | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const strength = passwordStrength(password);
  const birthDate =
    year.length === 4 && month.length >= 1 && day.length >= 1
      ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
      : '';

  const normalizedUsername = normalizeUsername(username);

  // Debounced availability check; the result is stored with the value it was checked for.
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (!normalizedUsername || usernameError(normalizedUsername)) return;
    checkTimer.current = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(normalizedUsername);
        setUsernameCheck({ value: normalizedUsername, available: ok });
      } catch {
        setUsernameCheck({ value: normalizedUsername, available: null });
      }
    }, 450);
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [normalizedUsername]);

  const usernameStatus: UsernameStatus = !normalizedUsername
    ? 'idle'
    : usernameError(normalizedUsername)
      ? 'invalid'
      : usernameCheck?.value === normalizedUsername
        ? usernameCheck.available === null
          ? 'idle'
          : usernameCheck.available
            ? 'available'
            : 'taken'
        : 'checking';

  const submit = async () => {
    const parsed = signUpSchema.safeParse({ displayName, username, email, password, birthDate, countryCode, gender, acceptTerms });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    if (usernameStatus === 'taken') {
      setErrors({ username: 'That username is already taken.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await signUpWithEmail({
        email: parsed.data.email,
        password: parsed.data.password,
        displayName: parsed.data.displayName,
        username: parsed.data.username,
        birthDate: parsed.data.birthDate,
        countryCode: parsed.data.countryCode,
        gender: parsed.data.gender,
      });
      if (result.needsEmailConfirmation) {
        router.replace({ pathname: '/verify-email', params: { email: parsed.data.email } });
      } else {
        router.replace('/home');
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const usernameRight =
    usernameStatus === 'checking' ? (
      <ActivityIndicator size="small" color={colors.primary} />
    ) : usernameStatus === 'available' ? (
      <Ionicons name="checkmark-circle" size={20} color={palette.success} />
    ) : usernameStatus === 'taken' || usernameStatus === 'invalid' ? (
      <Ionicons name="close-circle" size={20} color={palette.danger} />
    ) : null;

  const usernameHelper =
    usernameStatus === 'available'
      ? 'Great, that username is available.'
      : usernameStatus === 'taken'
        ? 'That username is already taken.'
        : 'Letters, numbers, underscores and periods.';

  return (
    <AuthShell
      title="Create your account"
      subtitle="It only takes a minute. You must be at least 16 to join."
      footer={
        <View style={styles.footer}>
          <Text variant="body" color="textMuted">
            Already have an account?{' '}
          </Text>
          <Link href="/sign-in" asChild>
            <Pressable accessibilityRole="link">
              <Text variant="bodySemibold" color="primary">
                Sign in
              </Text>
            </Pressable>
          </Link>
        </View>
      }
    >
      <Input label="Display name" placeholder="How people will see you" value={displayName} onChangeText={setDisplayName} error={errors.displayName} maxLength={50} autoComplete="name" leftIcon="person-outline" />
      <Input
        label="Username"
        placeholder="yourname"
        prefix="@"
        value={username}
        onChangeText={(v) => setUsername(v.toLowerCase())}
        error={errors.username ?? (usernameStatus === 'taken' ? 'That username is already taken.' : undefined)}
        helper={usernameHelper}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={30}
        rightElement={usernameRight}
        containerStyle={{ marginTop: spacing.lg }}
      />
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
        containerStyle={{ marginTop: spacing.lg }}
      />
      <Input
        label="Password"
        placeholder="At least 8 characters"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        leftIcon="lock-closed-outline"
        containerStyle={{ marginTop: spacing.lg }}
      />
      {password.length > 0 ? (
        <View style={styles.strengthRow}>
          {[1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={[
                styles.strengthBar,
                { backgroundColor: i <= strength.score ? (strength.score <= 1 ? palette.danger : strength.score === 2 ? palette.warning : palette.success) : colors.surfaceStrong },
              ]}
            />
          ))}
          <Text variant="caption" color="textMuted" style={{ marginLeft: spacing.sm }}>
            {strength.label}
          </Text>
        </View>
      ) : null}

      <Text variant="smallMedium" color="textSecondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
        Date of birth
      </Text>
      <View style={styles.dobRow}>
        <Input placeholder="DD" value={day} onChangeText={(v) => setDay(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} containerStyle={styles.dobField} />
        <Input placeholder="MM" value={month} onChangeText={(v) => setMonth(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" maxLength={2} containerStyle={styles.dobField} />
        <Input placeholder="YYYY" value={year} onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} containerStyle={[styles.dobField, { flex: 1.4 }]} />
      </View>
      <Text variant="small" color={errors.birthDate ? 'danger' : 'textMuted'} style={{ marginTop: spacing.xs, paddingHorizontal: spacing.xs }}>
        {errors.birthDate ?? `Only your age is shown to others. You must be ${APP.minSignupAge}+ to join.`}
      </Text>

      <View style={{ marginTop: spacing.lg }}>
        <CountryPicker value={countryCode || null} onChange={setCountryCode} error={errors.countryCode} />
      </View>

      <Text variant="smallMedium" color="textSecondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
        Gender (optional)
      </Text>
      <View style={styles.chips}>
        {GENDER_OPTIONS.map((g) => (
          <Chip key={g.value} label={g.label} size="sm" selected={gender === g.value} onPress={() => setGender(gender === g.value ? undefined : g.value)} />
        ))}
      </View>

      <Pressable onPress={() => setAcceptTerms((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: acceptTerms }} style={styles.terms}>
        <View style={[styles.checkbox, { borderColor: errors.acceptTerms ? palette.danger : acceptTerms ? colors.primary : colors.borderStrong, backgroundColor: acceptTerms ? colors.primary : 'transparent' }]}>
          {acceptTerms ? <Ionicons name="checkmark" size={14} color={palette.white} /> : null}
        </View>
        <Text variant="small" color="textSecondary" style={{ flex: 1 }}>
          I agree to the{' '}
          <Link href="/terms">
            <Text variant="smallMedium" color="primary">
              Terms of Service
            </Text>
          </Link>
          ,{' '}
          <Link href="/privacy">
            <Text variant="smallMedium" color="primary">
              Privacy Policy
            </Text>
          </Link>{' '}
          and{' '}
          <Link href="/guidelines">
            <Text variant="smallMedium" color="primary">
              Community Guidelines
            </Text>
          </Link>
          .
        </Text>
      </Pressable>
      {errors.acceptTerms ? (
        <Text variant="small" color="danger" style={{ marginTop: spacing.xs }}>
          {errors.acceptTerms}
        </Text>
      ) : null}

      <Button title="Create account" size="lg" fullWidth onPress={submit} loading={busy} style={{ marginTop: spacing['2xl'] }} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  strengthRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  strengthBar: { flex: 1, height: 4, borderRadius: 2, marginRight: 4 },
  dobRow: { flexDirection: 'row', gap: spacing.sm },
  dobField: { flex: 1, width: undefined },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  terms: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing['2xl'] },
  checkbox: { width: 22, height: 22, borderRadius: radius.xs, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md, marginTop: 1 },
});
