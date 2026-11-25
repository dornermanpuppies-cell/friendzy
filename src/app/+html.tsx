import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Runs before the app bundle on every page:
 * - keeps the browser's install prompt (Chrome / Edge / Samsung Internet fire
 *   `beforeinstallprompt` once the site is installable, often before React has
 *   hydrated) so the Download page can show a one-tap "Install app" button;
 * - registers the no-op service worker that some browsers still require for
 *   installability (public/sw.js caches nothing). Skipped on plain http (local dev).
 */
const INSTALL_BOOTSTRAP = `
(function(){
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__friendzyInstallPrompt=e;window.dispatchEvent(new Event('friendzy:installable'));});
  window.addEventListener('appinstalled',function(){window.__friendzyInstalled=true;window.__friendzyInstallPrompt=null;window.dispatchEvent(new Event('friendzy:installable'));});
  if('serviceWorker' in navigator&&location.protocol==='https:'){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});});}
})();
`.trim();

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
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta property="og:site_name" content="Friendzy" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icon-512.png" />
        <meta name="twitter:card" content="summary" />
        <ScrollViewStyleReset />
        {headNodes}
        <script dangerouslySetInnerHTML={{ __html: INSTALL_BOOTSTRAP }} />
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
