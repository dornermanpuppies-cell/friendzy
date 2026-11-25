import type { Metadata } from 'expo-router/server';

import { ArticleSection, Bullet, MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';

export function generateMetadata(): Metadata {
  return { title: 'Friendzy Community Guidelines', description: 'The rules that keep Friendzy safe, respectful and fun for everyone.' };
}

export default function GuidelinesPage() {
  return (
    <MarketingLayout>
      <MarketingArticle title="Community Guidelines" subtitle="Friendzy is a place to meet, connect, play and earn — safely. These rules apply to every profile, post, video, message, livestream and game." updated="25 November 2026">
        <ArticleSection title="1. Be respectful">
          <Bullet>No harassment, bullying, threats or targeted abuse.</Bullet>
          <Bullet>No hate speech or attacks based on race, ethnicity, nationality, religion, gender, sexual orientation, disability or any other protected characteristic.</Bullet>
          <Bullet>Disagree with ideas, never dehumanise people.</Bullet>
        </ArticleSection>
        <ArticleSection title="2. Keep it safe">
          <Bullet>Friendzy is for people aged 16 and over. Features such as random matching, livestreaming, gifts and nearby discovery are limited to adults (18+).</Bullet>
          <Bullet>No sexual content, nudity or sexual solicitation. Any sexual content involving minors is reported to the authorities.</Bullet>
          <Bullet>No content that promotes self-harm, eating disorders, dangerous challenges or violence.</Bullet>
          <Bullet>{"Never share someone else's private information (addresses, phone numbers, documents) without consent."}</Bullet>
        </ArticleSection>
        <ArticleSection title="3. Be authentic">
          <Bullet>Use your real identity or a clearly non-deceptive persona. Impersonating people, brands or Friendzy staff is prohibited.</Bullet>
          <Bullet>No spam, scams, fake giveaways, pyramid schemes or artificial engagement.</Bullet>
          <Bullet>One person, one account. Automated or bulk account creation is not allowed.</Bullet>
        </ArticleSection>
        <ArticleSection title="4. Respect intellectual property">
          <Bullet>Only upload content you created or have the right to share, including music.</Bullet>
          <Bullet>We respond to valid copyright notices and may remove content or suspend repeat infringers.</Bullet>
        </ArticleSection>
        <ArticleSection title="5. Livestreams, gifts and games">
          <Bullet>Hosts are responsible for their rooms. Appoint moderators and remove guests who break the rules.</Bullet>
          <Bullet>Gifts are voluntary. Pressuring, misleading or manipulating people to send gifts or buy coins is prohibited.</Bullet>
          <Bullet>Cheating, exploiting or selling game accounts and rewards is not allowed.</Bullet>
        </ArticleSection>
        <ArticleSection title="6. Enforcement">
          <Paragraph>
            Depending on severity we may remove content, limit features, suspend or permanently ban accounts, and where required cooperate with law enforcement. You can
            report any profile, post, video, comment, message, livestream or gift from the app. Reports are confidential.
          </Paragraph>
        </ArticleSection>
      </MarketingArticle>
    </MarketingLayout>
  );
}
