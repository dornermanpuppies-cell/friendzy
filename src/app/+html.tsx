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
 * Keeps the app box the same size as the part of the screen the user can actually see.
 *
 * Expo's reset pins `#root` to `height: 100%` of the layout viewport. On a phone the on-screen
 * keyboard does not change that viewport (iOS Safari never does; Chrome only does when the viewport
 * meta asks for it), so the bottom of the app — the chat composer, the live chat box, any comment
 * field — ends up underneath the keyboard with no way to scroll to it.
 *
 * `visualViewport` reports the visible height, so the root is resized to match and the app lays
 * itself out above the keyboard, exactly like the native apps do. The CSS variables are published
 * for components that need the numbers (see src/hooks/useKeyboardInset.ts).
 */
const VIEWPORT_BOOTSTRAP = `
(function(){
  var vv = window.visualViewport;
  if (!vv) return;
  var root = document.documentElement;
  function sync(){
    var height = Math.round(vv.height);
    var inset = Math.max(0, Math.round(window.innerHeight - height - vv.offsetTop));
    var open = inset > 120;
    root.style.setProperty('--fz-app-height', height + 'px');
    root.style.setProperty('--fz-keyboard-inset', inset + 'px');
    root.classList.toggle('fz-keyboard-open', open);
    var app = document.getElementById('root');
    if (app) app.style.height = height + 'px';
    // Some browsers scroll the page to reveal the focused field; the app box already fits, so undo it.
    if (open && window.scrollY !== 0) window.scrollTo(0, 0);
  }
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('orientationchange', function(){ setTimeout(sync, 350); });
  document.addEventListener('DOMContentLoaded', sync);
  window.__friendzySyncViewport = sync;
  sync();
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
        {/* interactive-widget: Chrome resizes the page when the on-screen keyboard opens instead of
            sliding it out of view, so the composer stays above the keyboard. Other browsers ignore it
            and are handled by VIEWPORT_BOOTSTRAP below. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover, interactive-widget=resizes-content" />
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
        <script dangerouslySetInnerHTML={{ __html: VIEWPORT_BOOTSTRAP }} />
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
