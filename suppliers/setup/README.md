# Activate Supplier Atlas accounts

The GitHub Pages interface is public code. Supplier records are held in the authenticated database and must never be committed to the GitHub repository. A login form alone does not protect static files.

## Activation status — 12 November 2026

The owner-controlled Supabase project `oovcwefatlebysksjbvd` is active and healthy. The create-only supplier schema has been applied. This site revision includes the project URL and browser-safe publishable key. The owner Auth account exists with active owner membership; no collaborator access has been created. Public sign-ups and anonymous sign-ins are disabled, and the exact site and account callback URLs are configured.

The owner has not set a password yet. A private one-time password-setup link was generated without sending an email; it is deliberately excluded from this repository. The temporary account-provisioning endpoint has been replaced with an HTTP 410 response and verified disabled. Live database authorization checks have passed, as recorded below. The remaining user-facing step is password setup followed by normal browser sign-in and a save/reload check.

## Complete owner activation

1. Project, schema, owner Auth account, and active owner membership are already present. Do not recreate them. Retain `supabase.sql` for a clean installation; it is a create-only transaction and must not be rerun against this provisioned schema.
2. Keep public sign-ups and anonymous sign-ins disabled. The Site URL is `https://kaptinodium.github.io/automobilewatch/suppliers/`, with the exact account callback `https://kaptinodium.github.io/automobilewatch/suppliers/account.html` on the redirect allowlist.
3. After the configured revision is published, the owner opens the private setup link, chooses a password on `account.html`, then signs in normally. Do not store the link, password, email address, or Auth UUID in public repository files. If the link expires or has already been used, an administrator must issue a new setup link.
4. Verify the hosted page uses the configured project, normal owner sign-in succeeds, and the shared list can be loaded, saved, and reloaded. Check revision-conflict handling from two browser sessions after password setup. The database-side permissions and conflict behavior have already passed rollback-isolated checks.

## Add a collaborator later

Create or invite a collaborator only when access is requested. Use their verified address, add their Auth UUID to `supplier_members`, and let them choose their own password. Grant `viewer` for read-only access or `editor` when they need to save changes; the owner role is not needed for ordinary collaboration.

```sql
insert into public.supplier_members (user_id, display_name, role, active)
values
  ('COLLABORATOR_AUTH_UUID', 'Collaborator', 'viewer', true);
```

Complete membership before the collaborator opens an invitation or recovery link. All active members use the same saved supplier list.

## Invitation and recovery email templates

Custom SMTP is not configured. The dashboard requires custom SMTP before email templates can be edited, so the templates below are not installed and email callbacks/delivery have not been tested. Default email links are not supported by this site's token-hash callback. Use direct administrator-generated token-hash links for the current owner activation and password resets; never publish those private links.

To enable emailed invitations or recovery later, configure an owner-controlled SMTP sender, install these templates, and test delivery. In Supabase Auth > Email Templates, replace the action link in **Invite user** with:

```html
<a href="https://kaptinodium.github.io/automobilewatch/suppliers/account.html#token_hash={{ .TokenHash }}&amp;type=invite">Set your Supplier Atlas password</a>
```

Replace the action link in **Reset password** with:

```html
<a href="https://kaptinodium.github.io/automobilewatch/suppliers/account.html#token_hash={{ .TokenHash }}&amp;type=recovery">Reset your Supplier Atlas password</a>
```

Use these links rather than the default `{{ .ConfirmationURL }}`. The page supports only `invite` and `recovery` token-hash callbacks, not default access-token fragments or PKCE authorization-code redirects. Fragment values are not sent in the request to GitHub Pages. The page removes the fragment immediately, verifies the one-time hash with Supabase, and keeps its temporary session only in memory. It never loads supplier records. Only an active member can proceed to password setup. After a successful change, it signs out the temporary session and links back to the normal login page.

The new password must contain at least 12 characters and meet the project's password policy. Supabase's minimum password length is configured to 12. Expired/used links or accounts with missing membership need an administrator to correct membership and issue a fresh link. Reloading the setup page deliberately discards its temporary session. Test both the invitation and recovery flow with a controlled account before relying on delivery. If the project's email service restricts recipients, configure an owner-controlled SMTP sender before using invitations; never share administrator credentials with recipients.

Deactivate a member with `update public.supplier_members set active = false where user_id = 'AUTH_UUID';`. Policies check membership on each database request, so an existing token cannot bypass this revocation.

Browser sign-out clears the current session even if the network is unavailable. Supabase access tokens can otherwise remain valid until expiry; successful sign-out revokes refresh access. Use member deactivation when immediate removal of database access is required.

## Verification

All 38 local client checks passed, including a browser-fetch receiver regression check. Live SQL checks passed for anonymous access, signed-in non-members, viewer restrictions, editor and owner permissions, membership revocation, and revision conflicts. Those checks ran in rollback-isolated transactions; temporary fixtures were removed and the supplier dataset was unchanged. A separate anonymous REST request was denied with HTTP 401. These results verify the deployed database controls; owner password setup and the final hosted browser flow remain to be completed.

`node --test auth-core.test.mjs` checks the client-side session lifecycle, active membership checks, viewer restrictions, conflict handling, logout races, invitation/recovery callbacks, and password setup using controlled responses. These tests do **not** replace the live database and email-flow checks above.

Maintenance notes: leaked-password protection is unavailable on the project's current Free plan; no plan upgrade was requested. See [password security options](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The provisioning-only activation-claims table intentionally has RLS enabled without public policies and no grants to `anon` or `authenticated`; its RLS-without-policy advisory reflects denied client access.

Provider references: [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [user sessions](https://supabase.com/docs/guides/auth/sessions), [sign-out behavior](https://supabase.com/docs/guides/auth/signout), [email templates and token hashes](https://supabase.com/docs/guides/auth/auth-email-templates), [OTP verification](https://supabase.com/docs/reference/javascript/auth-verifyotp), [password updates](https://supabase.com/docs/reference/javascript/auth-updateuser), and [Auth REST endpoints](https://supabase.github.io/auth/).

