# Activate Supplier Atlas accounts

The GitHub Pages interface is public code. Supplier records are held in the authenticated database and must never be committed to the GitHub repository. A login form alone does not protect static files.

1. Use a Supabase project controlled by the site owner. Run `supabase.sql` in its SQL editor. The transaction creates the main empty dataset, enables row-level security, and allows only active members to read it. Only owners and editors can save.
2. Disable new public sign-ups and anonymous sign-ins in Auth settings. Set the Site URL to `https://kaptinodium.github.io/automobilewatch/suppliers/`. Add the exact account callback `https://kaptinodium.github.io/automobilewatch/suppliers/account.html` to the redirect allowlist. Configure the two email templates below **before** creating invitations or requesting a password reset.
3. Invite the two Auth accounts through Supabase's administrator dashboard using the owner's and Tudor's verified addresses. Add the memberships in step 4 before either person opens their invitation. Each recipient sets their own password on `account.html`, then signs in normally. Do not put passwords, service-role keys, secret keys, or invitation tokens in GitHub. For an existing account, the administrator can send a password recovery email from Auth user management; use the Reset password template below.
4. Copy their Auth user UUIDs into the following SQL, replacing the placeholders. The owner can edit; Tudor is an editor as a collaborator. Use `viewer` instead if read-only access is intended.

```sql
insert into public.supplier_members (user_id, display_name, role, active)
values
  ('OWNER_AUTH_UUID', 'Jack', 'owner', true),
  ('TUDOR_AUTH_UUID', 'Tudor', 'editor', true);
```

5. Set `supabaseUrl` and `supabaseAnonKey` in `config.json` to the project URL and **publishable key** (or legacy public `anon` key). These are intended for browser use. All access enforcement remains in the database policies and save function.
6. Before importing real supplier information, verify the deployed database with an anonymous request, a signed-in non-member, an active editor, and an active viewer. Anonymous/non-member reads must fail or return no rows; a viewer must be unable to call the save function or write tables directly. Direct table writes are denied even for editors: the save function is the only write path.
7. Test editing from two sessions: load the same revision in each, save in one, then save in the other. The second save must report a conflict and require reloading. Review the local changes before replacing the shared list.

## Invitation and recovery email templates

In Supabase Auth > Email Templates, replace the action link in **Invite user** with:

```html
<a href="https://kaptinodium.github.io/automobilewatch/suppliers/account.html#token_hash={{ .TokenHash }}&amp;type=invite">Set your Supplier Atlas password</a>
```

Replace the action link in **Reset password** with:

```html
<a href="https://kaptinodium.github.io/automobilewatch/suppliers/account.html#token_hash={{ .TokenHash }}&amp;type=recovery">Reset your Supplier Atlas password</a>
```

Use these links rather than the default `{{ .ConfirmationURL }}`. The page supports only `invite` and `recovery` token-hash callbacks, not default access-token fragments or PKCE authorization-code redirects. Fragment values are not sent in the request to GitHub Pages. The page removes the fragment immediately, verifies the one-time hash with Supabase, and keeps its temporary session only in memory. It never loads supplier records. Only an active member can proceed to password setup. After a successful change, it signs out the temporary session and links back to the normal login page.

The new password must contain at least 12 characters and meet the project's password policy. Set Supabase's minimum password length to at least 12 as well. Expired/used links or accounts with missing membership need an administrator to correct membership and issue a fresh link. Reloading the setup page deliberately discards its temporary session. Test both the invitation and recovery flow with a controlled account before relying on delivery. If the project's email service restricts recipients, configure an owner-controlled SMTP sender before inviting the two users; never share administrator credentials with them.

Deactivate a member with `update public.supplier_members set active = false where user_id = 'AUTH_UUID';`. Policies check membership on each database request, so an existing token cannot bypass this revocation.

Browser sign-out clears the current session even if the network is unavailable. Supabase access tokens can otherwise remain valid until expiry; successful sign-out revokes refresh access. Use member deactivation when immediate removal of database access is required.

## Verification

`node --test auth-core.test.mjs` checks the client-side session lifecycle, active membership checks, viewer restrictions, conflict handling, logout races, invitation/recovery callbacks, and password setup using controlled responses. These tests do **not** replace the live database and email-flow checks above.

Provider references: [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [user sessions](https://supabase.com/docs/guides/auth/sessions), [sign-out behavior](https://supabase.com/docs/guides/auth/signout), [email templates and token hashes](https://supabase.com/docs/guides/auth/auth-email-templates), [OTP verification](https://supabase.com/docs/reference/javascript/auth-verifyotp), [password updates](https://supabase.com/docs/reference/javascript/auth-updateuser), and [Auth REST endpoints](https://supabase.github.io/auth/).
