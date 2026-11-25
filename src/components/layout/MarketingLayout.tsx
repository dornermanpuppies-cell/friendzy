import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Text } from '@/components/ui/Text';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAuthStore } from '@/store/authStore';
import { ThemeScope, useTheme } from '@/theme/ThemeProvider';
import { layout, palette, spacing } from '@/theme/tokens';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/about', label: 'About' },
  { href: '/download', label: 'Download' },
  { href: '/help', label: 'Help' },
] as const;

const FOOTER_COLUMNS = [
  { title: 'Product', links: [{ href: '/features', label: 'Features' }, { href: '/download', label: 'Download' }, { href: '/sign-up', label: 'Create account' }] },
  { title: 'Company', links: [{ href: '/about', label: 'About Friendzy' }, { href: '/contact', label: 'Contact' }] },
  { title: 'Legal', links: [{ href: '/terms', label: 'Terms of Service' }, { href: '/privacy', label: 'Privacy Policy' }, { href: '/guidelines', label: 'Community Guidelines' }] },
  { title: 'Support', links: [{ href: '/help', label: 'Help & support' }, { href: '/contact', label: 'Report a problem' }] },
] as const;

export function MarketingHeader() {
  const { colors } = useTheme();
  const { isDesktop, isMobile } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const status = useAuthStore((s) => s.status);
  const signedIn = status === 'signedIn';

  return (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <View style={[styles.headerInner, { paddingHorizontal: isMobile ? spacing.lg : spacing['3xl'] }]}>
        <Pressable onPress={() => router.navigate('/')} accessibilityRole="link" accessibilityLabel="Friendzy home">
          <Logo size={32} />
        </Pressable>
        {isDesktop ? (
          <View style={styles.nav}>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} asChild>
                <Pressable style={styles.navItem}>
                  <Text variant="bodyMedium" color="textSecondary">
                    {item.label}
                  </Text>
                </Pressable>
              </Link>
            ))}
          </View>
        ) : null}
        <View style={styles.actions}>
          {!isMobile ? (
            signedIn ? (
              <Button title="Open Friendzy" size="sm" onPress={() => router.navigate('/home')} />
            ) : (
              <>
                <Button title="Sign in" variant="ghost" size="sm" onPress={() => router.navigate('/sign-in')} />
                <Button title="Get started" size="sm" onPress={() => router.navigate('/sign-up')} />
              </>
            )
          ) : null}
          {!isDesktop ? (
            <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel="Menu" style={styles.menuButton}>
              <Ionicons name={open ? 'close' : 'menu'} size={26} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {open && !isDesktop ? (
        <View style={[styles.mobileMenu, { borderTopColor: colors.border }]}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} asChild onPress={() => setOpen(false)}>
              <Pressable style={styles.mobileMenuItem}>
                <Text variant="bodyMedium">{item.label}</Text>
              </Pressable>
            </Link>
          ))}
          <View style={styles.mobileMenuActions}>
            {signedIn ? (
              <Button title="Open Friendzy" fullWidth onPress={() => router.navigate('/home')} />
            ) : (
              <>
                <Button title="Create account" fullWidth onPress={() => router.navigate('/sign-up')} />
                <Button title="Sign in" variant="outline" fullWidth onPress={() => router.navigate('/sign-in')} style={{ marginTop: spacing.sm }} />
              </>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function MarketingFooter() {
  const { isMobile } = useBreakpoint();
  return (
    <ThemeScope scheme="dark">
      <View style={[styles.footer, { backgroundColor: palette.night }]}>
        <View style={[styles.footerInner, { paddingHorizontal: isMobile ? spacing.lg : spacing['3xl'] }]}>
          <View style={[styles.footerTop, isMobile && { flexDirection: 'column' }]}>
            <View style={styles.footerBrand}>
              <Logo size={30} color={palette.white} />
              <Text variant="body" color="rgba(255,255,255,0.7)" style={{ marginTop: spacing.md, maxWidth: 300 }}>
                Meet. Connect. Play. Earn. A worldwide social platform for genuine friendships, conversations, video and live moments.
              </Text>
            </View>
            <View style={[styles.footerColumns, isMobile && { marginTop: spacing['2xl'] }]}>
              {FOOTER_COLUMNS.map((col) => (
                <View key={col.title} style={styles.footerColumn}>
                  <Text variant="label" color="rgba(255,255,255,0.6)" style={{ marginBottom: spacing.md }}>
                    {col.title}
                  </Text>
                  {col.links.map((link) => (
                    <Link key={link.href + link.label} href={link.href} asChild>
                      <Pressable style={{ paddingVertical: spacing.xs + 2 }}>
                        <Text variant="small" color="rgba(255,255,255,0.85)">
                          {link.label}
                        </Text>
                      </Pressable>
                    </Link>
                  ))}
                </View>
              ))}
            </View>
          </View>
          <View style={[styles.footerBottom, { borderTopColor: 'rgba(255,255,255,0.1)' }]}>
            <Text variant="small" color="rgba(255,255,255,0.55)">
              © {new Date().getFullYear()} Friendzy. All rights reserved.
            </Text>
            <Text variant="small" color="rgba(255,255,255,0.55)">
              Made for people everywhere 🌍
            </Text>
          </View>
        </View>
      </View>
    </ThemeScope>
  );
}

/** Shell for the public website pages (landing, legal, help...). */
export function MarketingLayout({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <MarketingHeader />
      <ScrollView style={styles.page} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
        {children}
        <MarketingFooter />
      </ScrollView>
    </View>
  );
}

/** Centred text content column for legal/help pages. */
export function MarketingArticle({ title, subtitle, updated, children }: PropsWithChildren<{ title: string; subtitle?: string; updated?: string }>) {
  const { isMobile } = useBreakpoint();
  return (
    <View style={[styles.article, { paddingHorizontal: isMobile ? spacing.lg : spacing['3xl'] }]}>
      <Text variant={isMobile ? 'h1' : 'hero'}>{title}</Text>
      {subtitle ? (
        <Text variant="bodyLg" color="textMuted" style={{ marginTop: spacing.md }}>
          {subtitle}
        </Text>
      ) : null}
      {updated ? (
        <Text variant="small" color="textMuted" style={{ marginTop: spacing.sm }}>
          Last updated: {updated}
        </Text>
      ) : null}
      <View style={{ marginTop: spacing['3xl'] }}>{children}</View>
    </View>
  );
}

export function ArticleSection({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <View style={{ marginBottom: spacing['3xl'] }}>
      <Text variant="h3" style={{ marginBottom: spacing.md }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Paragraph({ children }: PropsWithChildren) {
  return (
    <Text variant="bodyLg" color="textSecondary" style={{ marginBottom: spacing.md }}>
      {children}
    </Text>
  );
}

export function Bullet({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  return (
    <View style={styles.bullet}>
      <View style={[styles.bulletDot, { backgroundColor: colors.primary }]} />
      <Text variant="bodyLg" color="textSecondary" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  pageContent: { flexGrow: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 20, ...(Platform.OS === 'web' ? ({ position: 'sticky', top: 0 } as object) : null) },
  headerInner: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: layout.maxPageWidth,
    alignSelf: 'center',
  },
  nav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navItem: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mobileMenu: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  mobileMenuItem: { paddingVertical: spacing.md },
  mobileMenuActions: { marginTop: spacing.md },
  footer: { paddingVertical: spacing['5xl'] },
  footerInner: { width: '100%', maxWidth: layout.maxPageWidth, alignSelf: 'center' },
  footerTop: { flexDirection: 'row', justifyContent: 'space-between' },
  footerBrand: { flex: 1, maxWidth: 360 },
  footerColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing['3xl'] },
  footerColumn: { minWidth: 140 },
  footerBottom: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing['4xl'], paddingTop: spacing['2xl'], borderTopWidth: StyleSheet.hairlineWidth },
  article: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingVertical: spacing['5xl'] },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 10, marginRight: spacing.md },
});
