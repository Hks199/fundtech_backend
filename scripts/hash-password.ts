import { randomBytes, scrypt as scryptCallback } from 'node:crypto';

const password = process.argv[2];
if (!password || password.length < 12) throw new Error('Provide a password of at least 12 characters');
const salt = randomBytes(16);
const hash = await new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, 64, (error, derivedKey) => {
    if (error) reject(error); else resolve(derivedKey);
  });
});
process.stdout.write(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}\n`);
