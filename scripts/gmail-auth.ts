/**
 * One-time sign-in for the orders mailbox (M15: "pick the PO mail from info@ceebuildcompany.com").
 *
 *   npm run gmail-auth                      (uses GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from .env)
 *   npm run gmail-auth -- path/to/client.json   (or a Google "Desktop app" OAuth client file)
 *
 * Opens a Google sign-in link; sign in AS THE MAILBOX (info@ceebuildcompany.com) and allow
 * read-only Gmail access. The script prints GMAIL_REFRESH_TOKEN to put in the server .env.
 * Scope is gmail.readonly: the dashboard can never send, delete or change mail.
 */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function envFile(): Record<string, string> {
  const p = resolve(process.cwd(), '.env');
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
}

function client(): { id: string; secret: string } {
  const arg = process.argv[2];
  if (arg) {
    const j = JSON.parse(readFileSync(resolve(arg), 'utf8')) as { installed?: { client_id: string; client_secret: string }; web?: { client_id: string; client_secret: string } };
    const c = j.installed ?? j.web;
    if (!c) throw new Error('Not a Google OAuth client file (needs "installed" or "web").');
    return { id: c.client_id, secret: c.client_secret };
  }
  const e = { ...envFile(), ...process.env } as Record<string, string | undefined>;
  if (!e.GMAIL_CLIENT_ID || !e.GMAIL_CLIENT_SECRET) throw new Error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env, or pass the OAuth client JSON file.');
  return { id: e.GMAIL_CLIENT_ID, secret: e.GMAIL_CLIENT_SECRET };
}

async function main() {
  const { id, secret } = client();
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const redirect = `http://127.0.0.1:${port}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  })}`;
  console.log('\nOpen this link, sign in as the orders mailbox (e.g. info@ceebuildcompany.com) and allow access:\n');
  console.log(url, '\n');

  const code = await new Promise<string>((resolveCode, reject) => {
    server.on('request', (req, res) => {
      const q = new URL(req.url ?? '/', redirect).searchParams;
      const c = q.get('code');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(c ? 'Done - you can close this tab and go back to the terminal.' : `Sign-in failed: ${q.get('error') ?? 'no code'}`);
      if (c) resolveCode(c);
      else reject(new Error(q.get('error') ?? 'no code'));
    });
  });
  server.close();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const j = (await res.json()) as { refresh_token?: string; access_token?: string; error_description?: string };
  if (!j.refresh_token) throw new Error(`No refresh token returned (${j.error_description ?? res.status}).`);
  const profile = (await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${j.access_token}` } })).json()) as { emailAddress?: string };
  console.log(`Signed in as ${profile.emailAddress ?? '(unknown)'}. Add these to the server .env (and .env.production), then restart:\n`);
  console.log(`GMAIL_CLIENT_ID="${id}"`);
  console.log(`GMAIL_CLIENT_SECRET="${secret}"`);
  console.log(`GMAIL_REFRESH_TOKEN="${j.refresh_token}"`);
  console.log(`GMAIL_MAILBOX="${profile.emailAddress ?? 'info@ceebuildcompany.com'}"\n`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
