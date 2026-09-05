'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/lib/auth';
import { loginSchema } from '@/lib/validation/auth';

export interface LoginState {
  error?: string;
}

/**
 * A PIN is short, so an online guessing attack is the realistic threat. This
 * counter bounds it per name.
 *
 * In-memory, therefore per-instance: good enough for a single-tenant shop tool
 * on one server, and the right thing to move to the database if this is ever
 * deployed across more than one instance.
 */
const ATTEMPTS = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 5 * 60_000;

function rateLimit(name: string): boolean {
  const now = Date.now();
  const rec = ATTEMPTS.get(name);
  if (!rec || now > rec.until) {
    ATTEMPTS.set(name, { count: 1, until: now + LOCKOUT_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= MAX_ATTEMPTS;
}

function clearLimit(name: string) {
  ATTEMPTS.delete(name);
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    name: formData.get('name'),
    pin: formData.get('pin'),
    next: formData.get('next'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details' };
  }

  const { name, pin, next } = parsed.data;

  if (!rateLimit(name)) {
    return { error: 'Too many attempts. Wait five minutes and try again.' };
  }

  try {
    // `redirectTo` throws NEXT_REDIRECT on success, which must escape this
    // function — hence the AuthError-only catch below.
    await signIn('credentials', {
      name,
      pin,
      redirectTo: next && next.startsWith('/') ? next : '/catalog',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'That name and PIN do not match.' };
    }
    throw error;
  }

  clearLimit(name);
  return {};
}
