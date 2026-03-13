import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 200;
const SCRYPT_KEY_LENGTH = 64;

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string') {
    return 'Password is required';
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be shorter than ${PASSWORD_MAX_LENGTH + 1} characters`;
  }

  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const validationError = validatePassword(password);
  if (validationError) {
    throw new Error(validationError);
  }

  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (typeof storedHash !== 'string' || !storedHash.startsWith('scrypt:')) {
    return false;
  }

  const [, salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) {
    return false;
  }

  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');

  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}
