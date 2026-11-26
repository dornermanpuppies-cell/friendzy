# Supabase Auth email templates (branded)

Applied to the live project on 2026-11-26 (Authentication → Email Templates). They are plain Supabase templates, so they
work with any SMTP provider (Gmail, Resend, Brevo…) and need no Edge Function. Confirmation, recovery, magic-link and invite
links point at the website's `/auth/confirm` route with `token_hash` + `type`, which verifies on **any** device or browser
(the default `{{ .ConfirmationURL }}` only works in the browser that started the flow when PKCE is used). Email change keeps
`{{ .ConfirmationURL }}` because Supabase sends two differently-tokened emails for it.

| Template | Subject |
| --- | --- |
| `confirmation.html` | Confirm your email to start on Friendzy |
| `recovery.html` | Reset your Friendzy password |
| `magic_link.html` | Your Friendzy sign-in link |
| `invite.html` | You have been invited to Friendzy |
| `email_change.html` | Confirm your new Friendzy email address |
| `reauthentication.html` | {{ .Token }} is your Friendzy verification code |

To re-apply: paste each file into Dashboard → Authentication → Email Templates (the subject lines above go in the Subject field).
