/**
 * A copy of hashPin from src/lib/auth/password.ts without the `server-only`
 * import, which the Node runner outside Next cannot resolve. The format —
 * scrypt$<salt-hex>$<key-hex> — must stay identical, so change both together.
 */
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(pin, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
