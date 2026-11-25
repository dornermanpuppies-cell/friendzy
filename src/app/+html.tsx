import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Root HTML for every statically rendered web page. Runs only in Node.js at
 * build time — no browser APIs here. Global providers live in app/_layout.tsx.
 */
export default function Root({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#7000FF" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#090817" />
        <meta name="application-name" content="Friendzy" />
        <meta name="apple-mobile-web-app-title" content="Friendzy" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta property="og:site_name" content="Friendzy" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
