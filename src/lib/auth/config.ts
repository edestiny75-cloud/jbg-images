import type { NextAuthConfig } from 'next-auth';
// Type-only, erased at build: makes the module resolvable for the augmentation below.
import type {} from 'next-auth/jwt';
import { isRole, type Role } from './roles';

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * `middleware.ts` runs in the Edge runtime, where Prisma cannot. This module
 * therefore holds only what the middleware needs — session shape, callbacks,
 * page paths — and declares no providers and no adapter. The full config in
 * ./index.ts extends it.
 */
export const authConfig = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the sign-in pass.
      if (user) {
        token.role = isRole(user.role) ? user.role : 'packer';
        token.userId = user.id ?? token.sub;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = (token.userId as string | undefined) ?? token.sub ?? '';
      session.user.role = isRole(token.role) ? token.role : 'packer';
      return session;
    },
  },
} satisfies NextAuthConfig;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name: string;
      role: Role;
      email?: string | null;
      image?: string | null;
    };
  }
  interface User {
    role?: Role;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role;
    userId?: string;
  }
}
