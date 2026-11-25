import type { Metadata } from 'expo-router/server';

import { ArticleSection, Bullet, MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';

export function generateMetadata(): Metadata {
  return { title: 'Friendzy Terms of Service', description: 'The terms that govern your use of Friendzy.' };
}

export default function TermsPage() {
  return (
    <MarketingLayout>
      <MarketingArticle title="Terms of Service" subtitle="This draft must be reviewed by qualified legal counsel before launch. By using Friendzy you agree to these terms and to our Community Guidelines and Privacy Policy." updated="25 November 2026">
        <ArticleSection title="1. Eligibility">
          <Paragraph>You must be at least 16 years old to create an account. Certain features (random matching, livestreaming, gifts, nearby discovery and paid features) are available only to users aged 18 or over.</Paragraph>
        </ArticleSection>
        <ArticleSection title="2. Your account">
          <Bullet>Provide accurate information and keep your password secure. You are responsible for activity on your account.</Bullet>
          <Bullet>You may delete your account at any time from Settings.</Bullet>
          <Bullet>We may suspend or terminate accounts that violate these terms or our Community Guidelines.</Bullet>
        </ArticleSection>
        <ArticleSection title="3. Your content">
          <Paragraph>You keep ownership of what you post. You grant Friendzy a worldwide, non-exclusive, royalty-free licence to host, store, display and distribute your content for the purpose of operating and promoting the service. You are responsible for having the rights to anything you upload, including music.</Paragraph>
        </ArticleSection>
        <ArticleSection title="4. Coins, gifts and creator earnings">
          <Bullet>Coins are a limited licence to use features within Friendzy; they are not money, have no cash value and are non-refundable except where required by law.</Bullet>
          <Bullet>Gifts are voluntary and final. Creator earnings are subject to platform commissions, verification and applicable payout requirements, which will be published before withdrawals are enabled.</Bullet>
        </ArticleSection>
        <ArticleSection title="5. Friendzy Premium">
          <Paragraph>Premium is a recurring subscription billed through the App Store, Google Play or our approved card-payment provider. Subscriptions renew automatically until cancelled through the store or provider where you purchased them. Prices are shown before purchase.</Paragraph>
        </ArticleSection>
        <ArticleSection title="6. Acceptable use">
          <Paragraph>Do not misuse Friendzy: no unlawful content, harassment, scraping, reverse engineering, interference with the service, or circumvention of safety and payment systems. See the Community Guidelines for details.</Paragraph>
        </ArticleSection>
        <ArticleSection title="7. Disclaimers and liability">
          <Paragraph>Friendzy is provided “as is”. To the extent permitted by law we disclaim implied warranties and limit our liability to the amount you paid us in the 12 months before a claim. Nothing in these terms limits liability that cannot be limited by law.</Paragraph>
        </ArticleSection>
        <ArticleSection title="8. Changes">
          <Paragraph>We may update these terms. We will notify you of material changes in the app or by email. Continued use after changes take effect means you accept them.</Paragraph>
        </ArticleSection>
        <ArticleSection title="9. Contact">
          <Paragraph>legal@friendzy.app</Paragraph>
        </ArticleSection>
      </MarketingArticle>
    </MarketingLayout>
  );
}
