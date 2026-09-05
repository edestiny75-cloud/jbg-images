import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { authConfig } from './config';
import { verifyPin } from './password';
import { isRole } from './roles';

/**
 * Sign-in is name + PIN.
 *
 * Chosen for the shop floor: the packer screen lives on a shared iPad, and a
 * six-digit PIN is the most that gets typed reliably with gloves on. The
 * trade-off is that the PIN space is small, so the login server action rate
 * limits by name and the PIN itself is scrypt-hashed.
 */
const credentialsSchema = z.object({
  name: z.string().trim().min(1).max(64),
  pin: z.string().min(4).max(32),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      name: 'PIN',
      credentials: {
        name: { label: 'Name', type: 'text' },
        pin: { label: 'PIN', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { name: parsed.data.name },
          select: { id: true, name: true, role: true, pinHash: true, active: true },
        });

        // Verify against a dummy hash even when the user is missing, so a bad
        // name and a bad PIN take the same amount of time.
        const hash = user?.pinHash ?? DUMMY_HASH;
        const ok = await verifyPin(parsed.data.pin, hash);

        if (!user || !user.active || !ok) return null;

        return {
          id: user.id,
          name: user.name,
          role: isRole(user.role) ? user.role : 'packer',
        };
      },
    }),
  ],
});

/** A structurally valid scrypt hash that no PIN matches. */
const DUMMY_HASH =
  'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

export * from './roles';
