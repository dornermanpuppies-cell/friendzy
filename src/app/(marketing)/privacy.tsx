import type { Metadata } from 'expo-router/server';

import { ArticleSection, Bullet, MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';

export function generateMetadata(): Metadata {
  return { title: 'Friendzy Privacy Policy', description: 'How Friendzy collects, uses and protects your personal data.' };
}

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <MarketingArticle title="Privacy Policy" subtitle="This draft policy describes how Friendzy handles personal data. It must be reviewed by qualified legal counsel for each market before launch." updated="25 November 2026">
        <ArticleSection title="1. Who we are">
          <Paragraph>Friendzy (“we”, “us”) operates the Friendzy website and the Friendzy applications for Android and iOS. Contact: privacy@friendzy.app.</Paragraph>
        </ArticleSection>
        <ArticleSection title="2. Data we collect">
          <Bullet>Account data: email address, password (hashed), display name, username, date of birth, country and optional gender.</Bullet>
          <Bullet>Profile data you choose to share: photos, bio, interests, city, website.</Bullet>
          <Bullet>Social activity: follows, friendships, blocks, reports, posts, videos, stories, comments, messages, calls, livestreams, gifts and game sessions.</Bullet>
          <Bullet>Technical data: device type, app version, IP address, approximate location (only if you enable nearby discovery), push notification tokens, session information.</Bullet>
          <Bullet>Payment data: subscription status and transaction identifiers from the App Store, Google Play or our card-payment provider. We never store full card numbers.</Bullet>
        </ArticleSection>
        <ArticleSection title="3. How we use data">
          <Bullet>To provide the service: accounts, discovery, messaging, calls, video, live, games and payments.</Bullet>
          <Bullet>To keep Friendzy safe: moderation, fraud prevention, age-appropriate experiences and enforcing our Community Guidelines.</Bullet>
          <Bullet>To personalise suggestions and content using your interests and activity.</Bullet>
          <Bullet>To communicate with you: verification, security alerts and (with your consent) product updates.</Bullet>
        </ArticleSection>
        <ArticleSection title="4. Your controls">
          <Bullet>Private account, discoverability, online status, last seen, who can message or comment, story audience and nearby discovery are all configurable in Settings → Privacy.</Bullet>
          <Bullet>Your exact location is never shown to other users.</Bullet>
          <Bullet>You can block and report anyone, review active sessions and delete your account at any time from Settings.</Bullet>
        </ArticleSection>
        <ArticleSection title="5. Sharing and processors">
          <Paragraph>
            We use trusted infrastructure providers to run Friendzy, including Supabase (database, authentication, storage), LiveKit (voice, video and livestream media),
            Resend (transactional email), Expo (push notifications and app services), RevenueCat and the app stores (subscriptions) and, on the web, an approved card-payment
            provider. We do not sell personal data.
          </Paragraph>
        </ArticleSection>
        <ArticleSection title="6. Retention and deletion">
          <Paragraph>We keep data while your account is active. When you delete your account, your profile and associated data are deleted, except where retention is required by law or for safety investigations.</Paragraph>
        </ArticleSection>
        <ArticleSection title="7. Children">
          <Paragraph>Friendzy is not available to anyone under 16. If we learn that a younger child has created an account, we delete it.</Paragraph>
        </ArticleSection>
        <ArticleSection title="8. Your rights">
          <Paragraph>Depending on where you live, you may have rights to access, correct, export, restrict or delete your data and to object to certain processing. Contact privacy@friendzy.app to exercise them.</Paragraph>
        </ArticleSection>
      </MarketingArticle>
    </MarketingLayout>
  );
}
