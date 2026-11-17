# Login, roles and user management

Viewing is public: every page and every read (GET) works without signing in. Creating,
editing, deleting, uploading and the AI actions require a login (`src/proxy.ts` plus
`requireUser` in each write handler).

Login is handled by NextAuth (`src/lib/auth/options.ts`, Credentials provider) with a signed
JWT session cookie (12 h). Passwords are hashed with scrypt. Users live in the `users` table.
The previous hand-rolled cookie auth is kept, commented out, as `LEGACY` blocks and
`route.legacy.ts` files.

## Sign up

Anyone can create an account at `/signup` (link on the login page) with full name, email
and password. Everyone signs in with **email + password**. New accounts get the
**User** role and are active immediately, so they can create and edit data straight away.
Each sign-up is recorded in the audit log (table `users`). Limit: 5 sign-ups per IP per hour.
To remove access: `npm run users -- disable <username>` or `set-role <username> Viewer`.

## Existing accounts and email

Accounts created before email login have no email. Until one is set they can still sign in
by typing their old username in the Email box. Give each of them an email (needs the
`20261117120000_add_user_email` migration):

```
npm run users -- list                       # shows "(no email)" for the ones to fix
npm run users -- set-email <username> <email>
```

## Roles

| Role   | Can do |
|--------|--------|
| Admin  | Everything: create/edit, **delete** dockets/items, change docket numbers, manage Master Dropdowns |
| User   | View, create and edit dockets, items and terms. Cannot delete, change docket numbers or master dropdowns |
| Viewer | Read-only (all writes return 403) |
| (not signed in) | Same read-only view as Viewer (writes return 401) |

Give Admin only to the named people who should have it.

## One-time setup (per environment)

1. Set `AUTH_SECRET` (32+ chars) in `.env` / the container environment, for example
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
   Without it nobody can sign in.
   Also set `NEXTAUTH_URL` to the address users open (e.g. `http://192.168.1.190:6011`).
   Docker: add both to the `environment:` block of `docker-compose.yml`.
2. Apply the migration `prisma/migrations/20261102090000_add_users_and_audit_user`
   (`npx prisma migrate deploy`). It only adds the `users` table and two nullable
   columns + an index on `edit-logs`. Take a DB backup first.
3. Create the first admin:

   ```
   npm run users -- add <username> --name "Full Name" --role Admin
   ```

   A random password is printed once. To choose it yourself without putting it in
   shell history, set `CEEBUILD_PASSWORD` for that command instead.

## Adding the CEEBUILD user list

Copy `config/users.example.json` to `config/users.json` (git-ignored), fill in the real
users, then run:

```
npm run users -- sync config/users.json            # create missing users, update names/roles
npm run users -- sync config/users.json --disable-missing   # also disable anyone not listed
```

New users get a generated password printed once; hand it over privately.

Other commands: `list`, `set-password <user>`, `set-role <user> <role>`, `disable <user>`,
`enable <user>`. Password/role changes and disabling sign the user out immediately.

## Audit log

Every create/edit/delete writes to `edit-logs` with the server-verified `user_id` and
`user_name`. Deletes store a JSON snapshot of the deleted rows in `old_value`.
Rows written before this change have no user.
