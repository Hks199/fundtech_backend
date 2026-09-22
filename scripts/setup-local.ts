import { randomBytes, scryptSync } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
try {
  await access(envPath);
  throw new Error('.env already exists; edit it instead of replacing its credentials');
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

const template = await readFile(resolve(process.cwd(), '.env.example'), 'utf8');
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
const passwordHash = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
const jwtSecret = randomBytes(48).toString('base64url');
const contents = template
  .replace(/^ADMIN_PASSWORD_HASH=.*$/m, () => `ADMIN_PASSWORD_HASH=${passwordHash}`)
  .replace(/^JWT_SECRET=.*$/m, () => `JWT_SECRET=${jwtSecret}`);

await writeFile(envPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
process.stdout.write(`Created .env for local development.\nUsername: admin\nPassword: ${password}\nSave the password now; it is not stored in plaintext.\n`);
