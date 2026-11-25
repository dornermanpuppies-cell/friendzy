import { Ionicons } from '@expo/vector-icons';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, shadows, spacing } from '@/theme/tokens';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle',
  success: 'checkmark-circle',
  error: 'alert-circle',
};

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const [translate] = useState(() => new Animated.Value(-120));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const hide = useCallback(() => {
    Animated.timing(translate, { toValue: -140, duration: 220, useNativeDriver: true }).start(() => setToast(null));
  }, [translate]);

  const show = useCallback(
    (options: ToastOptions) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ ...options, id: Date.now() });
      translate.setValue(-120);
      Animated.spring(translate, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
      timer.current = setTimeout(hide, options.duration ?? (options.tone === 'error' ? 5000 : 3200));
    },
    [hide, translate],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (title, description) => show({ title, description, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'error' }),
      info: (title, description) => show({ title, description, tone: 'info' }),
    }),
    [show],
  );

  const toneColor = toast?.tone === 'success' ? palette.success : toast?.tone === 'error' ? palette.danger : palette.purpleSoft;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.host, { top: (Platform.OS === 'web' ? 12 : insets.top + 8), transform: [{ translateY: translate }] }]}
        >
          <Pressable onPress={hide} style={[styles.toast, { backgroundColor: isDark ? colors.surfaceStrong : palette.ink }, shadows.md]}>
            <Ionicons name={ICONS[toast.tone ?? 'info']} size={22} color={toneColor} />
            <View style={styles.texts}>
              <Text variant="bodySemibold" color={palette.white} numberOfLines={2}>
                {toast.title}
              </Text>
              {toast.description ? (
                <Text variant="small" color="rgba(255,255,255,0.75)" numberOfLines={3}>
                  {toast.description}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = use(ToastContext);
  if (!ctx) {
    return {
      show: () => undefined,
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
    };
  }
  return ctx;
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000, paddingHorizontal: spacing.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 480,
    width: '100%',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  texts: { flex: 1, marginLeft: spacing.md },
});
