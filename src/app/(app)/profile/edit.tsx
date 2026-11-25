import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CountryPicker } from '@/components/ui/CountryPicker';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { pickImage, removeProfileImage, uploadProfileImage, type PickedImage } from '@/services/media';
import { isUsernameAvailable, updateMyProfile } from '@/services/profiles';
import { useAuth, useAuthStore } from '@/store/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';
import { editProfileSchema, zodFieldErrors } from '@/utils/validation';

export default function EditProfileScreen() {
  const { profile, user } = useAuth();
  const setProfile = useAuthStore((s) => s.setProfile);
  const toast = useToast();
  const { colors } = useTheme();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [countryCode, setCountryCode] = useState(profile?.country_code ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [website, setWebsite] = useState(profile?.website ?? '');
  const [avatar, setAvatar] = useState<PickedImage | null>(null);
  const [cover, setCover] = useState<PickedImage | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!profile || !user) return <Screen header={<ScreenHeader title="Edit profile" />} />;

  const choose = async (kind: 'avatar' | 'cover') => {
    try {
      const picked = await pickImage(kind);
      if (!picked) return;
      if (kind === 'avatar') setAvatar(picked);
      else setCover(picked);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const save = async () => {
    const parsed = editProfileSchema.safeParse({ displayName, username, bio, countryCode, city, website });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (parsed.data.username !== profile.username) {
        const available = await isUsernameAvailable(parsed.data.username);
        if (!available) {
          setErrors({ username: 'That username is already taken.' });
          setSaving(false);
          return;
        }
      }
      let avatarUrl = profile.avatar_url;
      let coverUrl = profile.cover_url;
      if (avatar) {
        avatarUrl = await uploadProfileImage(user.id, 'avatar', avatar);
        void removeProfileImage('avatar', profile.avatar_url);
      }
      if (cover) {
        coverUrl = await uploadProfileImage(user.id, 'cover', cover);
        void removeProfileImage('cover', profile.cover_url);
      }
      const updated = await updateMyProfile(user.id, {
        display_name: parsed.data.displayName,
        username: parsed.data.username,
        bio: parsed.data.bio || null,
        country_code: parsed.data.countryCode || null,
        city: parsed.data.city || null,
        website: parsed.data.website || null,
        avatar_url: avatarUrl,
        cover_url: coverUrl,
      });
      setProfile(updated);
      toast.success('Profile updated');
      if (router.canGoBack()) router.back();
      else router.replace('/profile');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const coverPreview = cover?.uri ?? profile.cover_url;

  return (
    <Screen header={<ScreenHeader title="Edit profile" fallbackHref="/profile" right={<Button title="Save" size="sm" onPress={save} loading={saving} />} />} scroll>
      {/* Cover */}
      <Pressable onPress={() => choose('cover')} style={styles.cover} accessibilityRole="button" accessibilityLabel="Change cover image">
        {coverPreview ? (
          <Image source={{ uri: coverPreview }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient colors={['#1B0B3E', palette.purple, palette.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        )}
        <View style={styles.coverOverlay}>
          <Ionicons name="camera" size={18} color={palette.white} />
          <Text variant="smallMedium" color={palette.white} style={{ marginLeft: 6 }}>
            Change cover
          </Text>
        </View>
      </Pressable>

      {/* Avatar */}
      <View style={styles.avatarRow}>
        <Pressable onPress={() => choose('avatar')} accessibilityRole="button" accessibilityLabel="Change profile picture">
          <View style={[styles.avatarRing, { borderColor: colors.background }]}>
            <Avatar uri={avatar?.uri ?? profile.avatar_url} name={displayName || profile.display_name} size={96} />
          </View>
          <View style={[styles.avatarBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Ionicons name="camera" size={14} color={palette.white} />
          </View>
        </Pressable>
        <Button title="Change photo" variant="ghost" size="sm" onPress={() => choose('avatar')} />
      </View>

      <Input label="Display name" value={displayName} onChangeText={setDisplayName} error={errors.displayName} maxLength={50} containerStyle={{ marginTop: spacing.lg }} />
      <Input
        label="Username"
        prefix="@"
        value={username}
        onChangeText={(v) => setUsername(v.toLowerCase())}
        error={errors.username}
        helper={profile.username_changed_at ? 'Usernames can be changed once every 14 days.' : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={30}
        containerStyle={{ marginTop: spacing.lg }}
      />
      <Input label="Bio" value={bio} onChangeText={setBio} error={errors.bio} multiline maxLength={300} showCounter placeholder="Tell people about you" containerStyle={{ marginTop: spacing.lg }} />
      <View style={{ marginTop: spacing.lg }}>
        <CountryPicker value={countryCode || null} onChange={setCountryCode} error={errors.countryCode} allowClear />
      </View>
      <Input label="City" value={city} onChangeText={setCity} error={errors.city} maxLength={80} placeholder="Optional" containerStyle={{ marginTop: spacing.lg }} autoCapitalize="words" />
      <Input label="Website" value={website} onChangeText={setWebsite} error={errors.website} placeholder="https://" autoCapitalize="none" keyboardType="url" containerStyle={{ marginTop: spacing.lg }} />
      <Button title="Save changes" fullWidth size="lg" onPress={save} loading={saving} style={{ marginTop: spacing['2xl'] }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cover: { height: 150, borderRadius: radius.xl, overflow: 'hidden', marginTop: spacing.lg },
  coverOverlay: { position: 'absolute', right: spacing.md, bottom: spacing.md, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(9,8,23,0.55)', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: -40, paddingLeft: spacing.lg, gap: spacing.md },
  avatarRing: { borderWidth: 4, borderRadius: radius.full },
  avatarBadge: { position: 'absolute', right: 2, bottom: 2, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
