import type { Metadata } from 'expo-router/server';

import { ArticleSection, Bullet, MarketingArticle, MarketingLayout, Paragraph } from '@/components/layout/MarketingLayout';

export function generateMetadata(): Metadata {
  return { title: 'About Friendzy', description: 'Friendzy is a worldwide social platform built to help people meet, connect, play and earn.' };
}

export default function AboutPage() {
  return (
    <MarketingLayout>
      <MarketingArticle title="About Friendzy" subtitle="A social platform built for genuine connection — everywhere in the world.">
        <ArticleSection title="Our mission">
          <Paragraph>
            Friendzy exists to make it easy and safe to meet new people and build real friendships, wherever you live. We combine the best of social
            discovery, messaging, short video, livestreaming and social gaming into one connected experience with a single account across web, Android and iOS.
          </Paragraph>
        </ArticleSection>
        <ArticleSection title="What makes Friendzy different">
          <Bullet>Discovery designed around shared interests, not just looks or location.</Bullet>
          <Bullet>Messaging and calls that work like the apps you already love — with privacy controls you own.</Bullet>
          <Bullet>Creator tools, gifts and fan support so people can earn from what they create.</Bullet>
          <Bullet>Social games you can play together in seconds.</Bullet>
          <Bullet>Safety as a core feature: blocking, reporting, moderation and age-appropriate experiences.</Bullet>
        </ArticleSection>
        <ArticleSection title="Our promise">
          <Paragraph>Meet. Connect. Play. Earn. — and feel at home while you do it.</Paragraph>
        </ArticleSection>
      </MarketingArticle>
    </MarketingLayout>
  );
}
