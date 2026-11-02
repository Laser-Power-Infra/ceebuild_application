/**
 * CEEBUILD dashboard user management (login accounts).
 *
 * Run with:  npm run users -- <command> [args]
 *
 * Commands
 *   list
 *   add <username> --name "Full Name" [--role Admin|User|Viewer] [--password <pw>]
 *   set-password <username> [--password <pw>]
 *   set-role <username> <Admin|User|Viewer>
 *   disable <username>
 *   enable <username>
 *   sync <file.json> [--disable-missing]
 *
 * Passwords
 *   If --password is not given, the password is read from the CEEBUILD_PASSWORD env var,
 *   otherwise a random 16-character password is generated and printed ONCE.
 *   Minimum length is 10 characters. Passing --password puts it in your shell history, so prefer
 *   the env var or the generated password.
 *
 * sync file format (see config/users.example.json):
 *   [ { "username": "puja", "name": "Puja", "role": "Admin" }, ... ]
 *   - creates missing users (with generated passwords, printed once),
 *   - updates name/role of existing users,
 *   - with --disable-missing, disables active users that are not in the file.
 *
 * Changing a password or role, or disabling a user, bumps session_version so existing
 * logins of that user stop working immediately.
 *
 * Uses DATABASE_URL from .env. Requires the 20261102090000_add_users_and_audit_user migration.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import { hashPassword, generatePassword, MIN_PASSWORD_LENGTH } from '../src/lib/auth/password';

const ROLES = ['Admin', 'User', 'Viewer'] as const;
type Role = (typeof ROLES)[number];

const prisma = new PrismaClient();

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error(
    [
      'Usage: npm run users -- <command> [args]',
      '  list',
      '  add <username> --name "Full Name" [--role Admin|User|Viewer] [--password <pw>]',
      '  set-password <username> [--password <pw>]',
      '  set-role <username> <Admin|User|Viewer>',
      '  disable <username>',
      '  enable <username>',
      '  sync <file.json> [--disable-missing]',
    ].join('\n')
  );
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function normUsername(u: string | undefined): string {
  const v = (u || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(v)) usage(`invalid username "${u ?? ''}" (use 2-64 chars: a-z 0-9 . _ -)`);
  return v;
}

function parseRole(r: string | true | undefined, fallback?: Role): Role {
  if (r === undefined && fallback) return fallback;
  const match = ROLES.find((x) => typeof r === 'string' && x.toLowerCase() === r.toLowerCase());
  if (!match) usage(`role must be one of ${ROLES.join(', ')}`);
  return match;
}

function resolvePassword(flag: string | true | undefined): { password: string; generated: boolean } {
  if (typeof flag === 'string') return { password: flag, generated: false };
  if (process.env.CEEBUILD_PASSWORD) return { password: process.env.CEEBUILD_PASSWORD, generated: false };
  return { password: generatePassword(16), generated: true };
}

function printPassword(username: string, password: string, generated: boolean) {
  if (generated) {
    console.log(`  Generated password for "${username}": ${password}`);
    console.log('  (shown only once - hand it over securely and ask the user to keep it private)');
  } else {
    console.log(`  Password for "${username}" set from ${process.env.CEEBUILD_PASSWORD ? 'CEEBUILD_PASSWORD' : '--password'}.`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  switch (command) {
    case 'list': {
      const users = await prisma.user.findMany({ orderBy: { username: 'asc' } });
      if (users.length === 0) console.log('No users yet. Create the first admin with: npm run users -- add <username> --name "Name" --role Admin');
      for (const u of users) {
        console.log(
          `${String(u.id).padStart(4)}  ${u.username.padEnd(20)} ${u.role.padEnd(7)} ${u.isActive ? 'active  ' : 'DISABLED'}  ${u.name}` +
            (u.lastLoginAt ? `  (last login ${u.lastLoginAt.toISOString()})` : '')
        );
      }
      break;
    }

    case 'add': {
      const username = normUsername(positional[0]);
      const name = typeof flags.name === 'string' ? flags.name.trim() : '';
      if (!name) usage('--name "Full Name" is required');
      const role = parseRole(flags.role, 'User');
      if (await prisma.user.findUnique({ where: { username } })) usage(`user "${username}" already exists`);
      const { password, generated } = resolvePassword(flags.password);
      const created = await prisma.user.create({
        data: { username, name, role, passwordHash: await hashPassword(password) },
      });
      console.log(`Created user #${created.id} "${username}" (${name}) with role ${role}.`);
      printPassword(username, password, generated);
      break;
    }

    case 'set-password': {
      const username = normUsername(positional[0]);
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) usage(`user "${username}" not found`);
      const { password, generated } = resolvePassword(flags.password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), sessionVersion: { increment: 1 } },
      });
      console.log(`Password updated for "${username}" (existing sessions signed out).`);
      printPassword(username, password, generated);
      break;
    }

    case 'set-role': {
      const username = normUsername(positional[0]);
      const role = parseRole(positional[1]);
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) usage(`user "${username}" not found`);
      await prisma.user.update({ where: { id: user.id }, data: { role, sessionVersion: { increment: 1 } } });
      console.log(`Role of "${username}" set to ${role} (existing sessions signed out).`);
      break;
    }

    case 'disable':
    case 'enable': {
      const username = normUsername(positional[0]);
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) usage(`user "${username}" not found`);
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: command === 'enable', sessionVersion: { increment: 1 } },
      });
      console.log(`User "${username}" ${command}d.`);
      break;
    }

    case 'sync': {
      const file = positional[0];
      if (!file || !fs.existsSync(file)) usage('sync needs a path to an existing JSON file');
      const list = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!Array.isArray(list)) usage('sync file must contain a JSON array');

      const seen = new Set<string>();
      for (const entry of list) {
        const username = normUsername(entry?.username);
        const name = String(entry?.name || '').trim() || username;
        const role = parseRole(entry?.role, 'User');
        seen.add(username);

        const existing = await prisma.user.findUnique({ where: { username } });
        if (!existing) {
          const password = generatePassword(16);
          await prisma.user.create({ data: { username, name, role, passwordHash: await hashPassword(password) } });
          console.log(`+ created ${username} (${name}) as ${role}`);
          printPassword(username, password, true);
        } else if (existing.name !== name || existing.role !== role) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { name, role, ...(existing.role !== role ? { sessionVersion: { increment: 1 } } : {}) },
          });
          console.log(`~ updated ${username}: name="${name}", role=${role}`);
        } else {
          console.log(`= unchanged ${username}`);
        }
      }

      if (flags['disable-missing']) {
        const others = await prisma.user.findMany({ where: { isActive: true, username: { notIn: Array.from(seen) } } });
        for (const u of others) {
          await prisma.user.update({ where: { id: u.id }, data: { isActive: false, sessionVersion: { increment: 1 } } });
          console.log(`- disabled ${u.username} (not in ${file})`);
        }
      }
      break;
    }

    default:
      usage(command ? `unknown command "${command}"` : undefined);
  }
}

main()
  .catch((err) => {
    if (err instanceof Error && err.message.includes('at least')) {
      console.error(`Error: ${err.message} (minimum ${MIN_PASSWORD_LENGTH})`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
