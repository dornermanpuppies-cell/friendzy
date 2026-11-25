import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { StyleSheet } from 'react-native';

import { CreateTabButton, MobileTabBar, TAB_ICONS, TabButton } from '@/components/layout/MobileTabBar';
import { useBreakpoint } from '@/hooks/useBreakpoint';

/**
 * Main navigation: Home · Discover · Create · LIVE · Profile.
 * Headless tabs render the custom gradient bar on phones/tablets; on desktop the
 * triggers stay registered (so routes resolve) but the bar is hidden and the
 * sidebar in (app)/_layout.tsx takes over.
 */
export default function TabsLayout() {
  const { isDesktop } = useBreakpoint();
  return (
    <Tabs style={styles.tabs}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <MobileTabBar hidden={isDesktop}>
          <TabTrigger name="home" href="/home" asChild>
            <TabButton icon={TAB_ICONS.home} label="Home" />
          </TabTrigger>
          <TabTrigger name="discover" href="/discover" asChild>
            <TabButton icon={TAB_ICONS.discover} label="Discover" />
          </TabTrigger>
          <TabTrigger name="create" href="/create" asChild>
            <CreateTabButton />
          </TabTrigger>
          <TabTrigger name="live" href="/live" asChild>
            <TabButton icon={TAB_ICONS.live} label="LIVE" />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton icon={TAB_ICONS.profile} label="Profile" />
          </TabTrigger>
        </MobileTabBar>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabs: { flex: 1 },
  slot: { flex: 1 },
});
