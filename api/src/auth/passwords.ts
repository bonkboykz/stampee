import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export async function hashSecret(value: string): Promise<string> {
  return bcrypt.hash(value, ROUNDS);
}

export async function verifySecret(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash);
}
