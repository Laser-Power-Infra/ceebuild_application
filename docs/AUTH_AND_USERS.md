# Login, roles and user management

The dashboard requires a login for every page and API route (`src/middleware.ts`).
Sessions are an httpOnly, HMAC-signed cookie (`ceebuild_session`, 12 h). Passwords are
hashed with scrypt. Users live in the `users` table.

## Roles

| Role   | Can do |
|--------|--------|
| Admin  | Everything: create/edit, **delete** dockets/items, change docket numbers, manage Master Dropdowns |
| User   | View, create and edit dockets, items and terms. Cannot delete, change docket numbers or master dropdowns |
| Viewer | Read-only (all writes return 403) |

Give Admin only to the named people who should have it.

## One-time setup (per environment)

1. Set `AUTH_SECRET` (32+ chars) in `.env` / the container environment, for example
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
   Without it the app refuses every request.
   Docker: add `AUTH_SECRET` to the `environment:` block of `docker-compose.yml`.
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
