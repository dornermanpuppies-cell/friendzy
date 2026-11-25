import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';

const HANDLE = 22;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export interface ValueSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onComplete?: (value: number) => void;
  label?: string;
  format?: (value: number) => string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

/** Dependency-free single-value slider (works on web, Android and iOS). */
export function ValueSlider({ value, min, max, step = 1, onChange, onComplete, label, format, style, disabled }: ValueSliderProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const fromX = (x: number) => {
    const w = widthRef.current || 1;
    const raw = min + clamp(x / w, 0, 1) * (max - min);
    return clamp(Math.round(raw / step) * step, min, max);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => onChange(fromX(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => onChange(fromX(e.nativeEvent.locationX)),
      onPanResponderRelease: () => onComplete?.(valueRef.current),
      onPanResponderTerminate: () => onComplete?.(valueRef.current),
    }),
  ).current;

  const fraction = max > min ? (value - min) / (max - min) : 0;
  return (
    <View style={style}>
      {label || format ? (
        <View style={styles.labels}>
          {label ? <Text variant="smallMedium">{label}</Text> : <View />}
          <Text variant="small" color="textMuted">
            {format ? format(value) : String(value)}
          </Text>
        </View>
      ) : null}
      <View
        style={[styles.track, { opacity: disabled ? 0.5 : 1 }]}
        onLayout={(e: LayoutChangeEvent) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        {...responder.panHandlers}
      >
        <View style={[styles.rail, { backgroundColor: colors.surfaceStrong }]} />
        <View style={[styles.fill, { backgroundColor: colors.primary, width: fraction * width }]} />
        <View style={[styles.handle, { backgroundColor: palette.white, borderColor: colors.primary, left: fraction * width - HANDLE / 2 }]} />
      </View>
    </View>
  );
}

export interface RangeSliderProps {
  start: number;
  end: number;
  min: number;
  max: number;
  minRange?: number;
  onChange: (start: number, end: number) => void;
  onComplete?: (start: number, end: number) => void;
  format?: (value: number) => string;
  style?: StyleProp<ViewStyle>;
}

/** Two-handle range slider used for trimming. */
export function RangeSlider({ start, end, min, max, minRange = 0, onChange, onComplete, format, style }: RangeSliderProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const stateRef = useRef({ start, end });
  stateRef.current = { start, end };
  const active = useRef<'start' | 'end' | null>(null);

  const toValue = (x: number) => {
    const w = widthRef.current || 1;
    return min + clamp(x / w, 0, 1) * (max - min);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const v = toValue(e.nativeEvent.locationX);
        const { start: s, end: en } = stateRef.current;
        active.current = Math.abs(v - s) <= Math.abs(v - en) ? 'start' : 'end';
      },
      onPanResponderMove: (e) => {
        const v = toValue(e.nativeEvent.locationX);
        const { start: s, end: en } = stateRef.current;
        if (active.current === 'start') onChange(clamp(v, min, en - minRange), en);
        else onChange(s, clamp(v, s + minRange, max));
      },
      onPanResponderRelease: () => onComplete?.(stateRef.current.start, stateRef.current.end),
      onPanResponderTerminate: () => onComplete?.(stateRef.current.start, stateRef.current.end),
    }),
  ).current;

  const f = (v: number) => (max > min ? (v - min) / (max - min) : 0);
  return (
    <View style={style}>
      <View style={styles.labels}>
        <Text variant="small" color="textMuted">
          {format ? format(start) : String(start)}
        </Text>
        <Text variant="small" color="textMuted">
          {format ? format(end) : String(end)}
        </Text>
      </View>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        {...responder.panHandlers}
      >
        <View style={[styles.rail, { backgroundColor: colors.surfaceStrong }]} />
        <View style={[styles.fill, { backgroundColor: colors.primary, left: f(start) * width, width: (f(end) - f(start)) * width }]} />
        <View style={[styles.handle, { backgroundColor: palette.white, borderColor: colors.primary, left: f(start) * width - HANDLE / 2 }]} />
        <View style={[styles.handle, { backgroundColor: palette.white, borderColor: colors.primary, left: f(end) * width - HANDLE / 2 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  track: { height: 32, justifyContent: 'center' },
  rail: { height: 4, borderRadius: 2 },
  fill: { position: 'absolute', height: 4, borderRadius: 2 },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, borderWidth: 2 },
});
