import { router } from 'expo-router';
import { Linking } from 'react-native';

import { Text, type TextProps } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

type Token = { kind: 'text' | 'hashtag' | 'mention' | 'url'; value: string };

const TOKEN_REGEX = /(#[\p{L}\p{N}_]{2,50})|(@[A-Za-z0-9_.]{3,30})|(https?:\/\/[^\s<]+)/gu;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_REGEX)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: 'text', value: text.slice(last, index) });
    const [raw] = match;
    tokens.push({ kind: raw.startsWith('#') ? 'hashtag' : raw.startsWith('@') ? 'mention' : 'url', value: raw });
    last = index + raw.length;
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) });
  return tokens;
}

export interface RichTextProps extends TextProps {
  text: string;
  onPressLink?: () => void;
}

/** Renders #hashtags, @mentions and links as tappable spans. */
export function RichText({ text, onPressLink, ...rest }: RichTextProps) {
  const { colors } = useTheme();
  const tokens = tokenize(text);
  return (
    <Text {...rest}>
      {tokens.map((token, i) => {
        if (token.kind === 'text') return <Text key={i} {...rest}>{token.value}</Text>;
        const onPress = () => {
          onPressLink?.();
          if (token.kind === 'hashtag') router.navigate(`/tag/${token.value.slice(1).toLowerCase()}` as never);
          else if (token.kind === 'mention') router.navigate(`/u/${token.value.slice(1).replace(/\.$/, '').toLowerCase()}` as never);
          else Linking.openURL(token.value).catch(() => undefined);
        };
        return (
          <Text key={i} {...rest} style={[rest.style, { color: colors.primary, fontWeight: '600' }]} onPress={onPress} suppressHighlighting>
            {token.value}
          </Text>
        );
      })}
    </Text>
  );
}
