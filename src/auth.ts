import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';

const key = new TextEncoder().encode(config.JWT_SECRET);

export async function verifyPassword(password: string): Promise<boolean> {
  const [, salt, expectedHex] = config.ADMIN_PASSWORD_HASH.split('$');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, Buffer.from(salt, 'hex'), expected.length, (error, derivedKey) => {
      if (error) reject(error); else resolve(derivedKey);
    });
  });
  return timingSafeEqual(actual, expected);
}

export async function createToken() {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('fifo-inventory')
    .setAudience('fifo-inventory-api')
    .setSubject(config.ADMIN_USERNAME)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    if (!match) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await jwtVerify(match[1], key, { issuer: 'fifo-inventory', audience: 'fifo-inventory-api', algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
