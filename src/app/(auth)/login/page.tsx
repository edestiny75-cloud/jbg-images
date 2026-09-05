import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in · JBG Fulfillment' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only same-origin paths, so `?next=` cannot be used as an open redirect.
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <LoginForm next={safeNext} />
    </main>
  );
}
