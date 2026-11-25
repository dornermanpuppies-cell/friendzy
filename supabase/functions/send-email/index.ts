// Friendzy — Supabase "Send Email" auth hook → Resend
//
// Supabase Auth calls this function (instead of its built-in SMTP) for every
// authentication email: sign-up verification, password recovery, email change,
// magic link, invite and re-authentication codes.
//
// Configuration (docs/CONFIGURATION.md → Email):
//   1. supabase secrets set RESEND_API_KEY=... RESEND_FROM_EMAIL=... SITE_URL=... SEND_EMAIL_HOOK_SECRET=...
//   2. supabase functions deploy send-email --no-verify-jwt
//   3. Dashboard → Authentication → Hooks → "Send Email" → HTTPS → this function URL
//
// Links use the token_hash flow (/auth/confirm) so they work even when the
// email is opened on a different device than the one that started the flow.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

type EmailActionType =
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'email'
  | 'reauthentication';

interface HookPayload {
  user: { id: string; email: string; new_email?: string; user_metadata?: Record<string, unknown> };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: EmailActionType;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Friendzy <no-reply@friendzy.app>';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'http://localhost:8081').replace(/\/$/, '');

const BRAND = {
  purple: '#7000FF',
  pink: '#FF28B9',
  blue: '#276BFF',
  dark: '#090817',
  text: '#171326',
  muted: '#6B6680',
  lavender: '#F3EEFF',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function confirmLink(tokenHash: string, type: string, redirectTo: string): string {
  const url = new URL(`${SITE_URL}/auth/confirm`);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', type);
  if (redirectTo) url.searchParams.set('next', redirectTo);
  return url.toString();
}

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px auto 8px"><tr><td style="border-radius:999px;background:linear-gradient(90deg,${BRAND.purple},${BRAND.pink});">
         <a href="${cta.url}" style="display:inline-block;padding:14px 30px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(cta.label)}</a>
       </td></tr></table>
       <p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${BRAND.muted};text-align:center;">If the button doesn't work, copy this link into your browser:<br><a href="${cta.url}" style="color:${BRAND.purple};word-break:break-all;">${cta.url}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.lavender};font-family:Inter,Segoe UI,Arial,sans-serif;color:${BRAND.text};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.lavender};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 12px 40px rgba(112,0,255,0.12);">
        <tr><td style="background:linear-gradient(120deg,${BRAND.blue},${BRAND.purple} 55%,${BRAND.pink});padding:28px 32px;">
          <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Friendzy</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">Meet. Connect. Play. Earn.</div>
        </td></tr>
        <tr><td style="padding:32px 32px 28px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:30px;font-weight:800;color:${BRAND.text};">${escapeHtml(title)}</h1>
          ${bodyHtml}
          ${button}
        </td></tr>
        <tr><td style="padding:18px 32px 26px;border-top:1px solid #EEE9F7;font-size:12px;line-height:18px;color:${BRAND.muted};">
          You're receiving this email because of activity on your Friendzy account. If you didn't request this, you can safely ignore it.<br>
          <a href="${SITE_URL}/help" style="color:${BRAND.purple};">Help center</a> · <a href="${SITE_URL}/privacy" style="color:${BRAND.purple};">Privacy</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 10px;font-size:15px;line-height:24px;color:#3D3850;">${text}</p>`;
}

function buildEmail(payload: HookPayload): { subject: string; html: string; to: string } {
  const { user, email_data: d } = payload;
  const name = escapeHtml(String(user.user_metadata?.display_name ?? '').trim() || 'there');
  const to = user.email;

  switch (d.email_action_type) {
    case 'signup':
    case 'email': {
      const url = confirmLink(d.token_hash, 'signup', d.redirect_to);
      return {
        to,
        subject: 'Confirm your email to start on Friendzy',
        html: layout(
          `Welcome to Friendzy, ${name}!`,
          paragraph('You are one tap away from meeting new people, chatting, going live and playing together.') +
            paragraph('Confirm your email address to activate your account.'),
          { label: 'Confirm my email', url },
        ),
      };
    }
    case 'recovery': {
      const url = confirmLink(d.token_hash, 'recovery', d.redirect_to);
      return {
        to,
        subject: 'Reset your Friendzy password',
        html: layout(
          'Reset your password',
          paragraph(`Hi ${name}, we received a request to reset the password for your Friendzy account.`) +
            paragraph('This link expires in 1 hour. If you did not request a reset, no action is needed.'),
          { label: 'Choose a new password', url },
        ),
      };
    }
    case 'magiclink': {
      const url = confirmLink(d.token_hash, 'magiclink', d.redirect_to);
      return {
        to,
        subject: 'Your Friendzy sign-in link',
        html: layout(
          'Sign in to Friendzy',
          paragraph(`Hi ${name}, use the button below to sign in. The link expires in 1 hour.`),
          { label: 'Sign in', url },
        ),
      };
    }
    case 'invite': {
      const url = confirmLink(d.token_hash, 'invite', d.redirect_to);
      return {
        to,
        subject: 'You have been invited to Friendzy',
        html: layout(
          'You are invited!',
          paragraph('Someone invited you to join Friendzy. Accept the invitation to create your account.'),
          { label: 'Accept invitation', url },
        ),
      };
    }
    case 'email_change': {
      // Supabase sends one email to the old address and one to the new address
      // when "secure email change" is enabled; token_hash_new belongs to the new address.
      const isNewAddress = Boolean(d.token_hash_new) && user.new_email && to === user.email;
      const hash = isNewAddress ? d.token_hash_new! : d.token_hash;
      const url = confirmLink(hash, 'email_change', d.redirect_to);
      return {
        to: isNewAddress ? user.new_email! : to,
        subject: 'Confirm your new Friendzy email address',
        html: layout(
          'Confirm email change',
          paragraph(`Hi ${name}, please confirm the change of your Friendzy email address${user.new_email ? ` to <strong>${escapeHtml(user.new_email)}</strong>` : ''}.`) +
            paragraph('If you did not request this change, secure your account by changing your password.'),
          { label: 'Confirm email change', url },
        ),
      };
    }
    case 'reauthentication': {
      return {
        to,
        subject: `${d.token} is your Friendzy verification code`,
        html: layout(
          'Your verification code',
          paragraph('Enter this code in Friendzy to confirm it is really you:') +
            `<div style="margin:18px 0;padding:18px;border-radius:16px;background:${BRAND.lavender};text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:${BRAND.purple};">${escapeHtml(d.token)}</div>` +
            paragraph('The code expires in a few minutes.'),
        ),
      };
    }
    default: {
      const url = confirmLink(d.token_hash, String(d.email_action_type), d.redirect_to);
      return {
        to,
        subject: 'Action required on your Friendzy account',
        html: layout('Confirm your request', paragraph('Use the button below to continue.'), { label: 'Continue', url }),
      };
    }
  }
}

async function sendWithResend(message: { to: string; subject: string; html: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [message.to], subject: message.subject, html: message.html }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { http_code: 405, message: 'Method not allowed' } }), { status: 405 });
  }
  if (!RESEND_API_KEY || !HOOK_SECRET) {
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: 'send-email function is not configured (RESEND_API_KEY / SEND_EMAIL_HOOK_SECRET missing)' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers);

  let payload: HookPayload;
  try {
    const wh = new Webhook(HOOK_SECRET.replace('v1,whsec_', ''));
    payload = wh.verify(rawBody, headers) as HookPayload;
  } catch (err) {
    console.error('Invalid hook signature', err);
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'Invalid signature' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const message = buildEmail(payload);
    await sendWithResend(message);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('send-email failed', err);
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: err instanceof Error ? err.message : 'Failed to send email' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
