import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useToast } from '@/components/ui/Toast';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';
import { useOnboardingStep } from '@/features/onboarding/useOnboardingStep';
import { pickImage, takePhoto, uploadProfileImage, type PickedImage } from '@/services/media';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { getErrorMessage } from '@/utils/errors';

export default function OnboardingPhotoScreen() {
  const { index, saving, advance, skip, user, profile } = useOnboardingStep('photo');
  const { colors } = useTheme();
  const toast = useToast();
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [uploading, setUploading] = useState(false);

  const choose = async (source: 'library' | 'camera') => {
    try {
      const image = source === 'camera' ? await takePhoto('avatar') : await pickImage('avatar');
      if (image) setPicked(image);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const continueWithPhoto = async () => {
    if (!user) return;
    if (!picked) {
      await advance();
      return;
    }
    setUploading(true);
    try {
      const url = await uploadProfileImage(user.id, 'avatar', picked);
      await advance({ avatar_url: url });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const preview = picked?.uri ?? profile?.avatar_url ?? null;

  return (
    <OnboardingShell
      step={index}
      title="Add a profile picture"
      subtitle="Profiles with a photo get many more friend requests. You can change it anytime."
      primaryLabel={picked ? 'Use this photo' : profile?.avatar_url ? 'Continue' : 'Continue without photo'}
      onPrimary={continueWithPhoto}
      primaryLoading={saving || uploading}
      onSkip={skip}
    >
      <View style={styles.center}>
        <View>
          <Avatar uri={preview} name={profile?.display_name} size={160} ring={Boolean(preview)} />
          <View style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Ionicons name="camera" size={18} color="#fff" />
          </View>
        </View>
        <Text variant="h3" style={{ marginTop: spacing.lg }}>
          {profile?.display_name}
        </Text>
        <Text variant="body" color="textMuted">
          @{profile?.username}
        </Text>
        <View style={styles.actions}>
          <Button title="Choose from library" leftIcon="images-outline" variant="secondary" onPress={() => choose('library')} />
          {Platform.OS !== 'web' ? <Button title="Take a photo" leftIcon="camera-outline" variant="outline" onPress={() => choose('camera')} style={{ marginTop: spacing.sm }} /> : null}
        </View>
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: spacing.lg },
  cameraBadge: { position: 'absolute', right: 6, bottom: 6, width: 38, height: 38, borderRadius: 19, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  actions: { marginTop: spacing['2xl'], alignItems: 'center' },
});
