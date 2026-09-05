import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { atLeast } from '@/lib/auth/roles';
import { NAV } from '@/lib/nav';
import { NavTabs } from '@/components/ui/NavTabs';
import { SignOutButton } from '@/components/ui/SignOutButton';
import { ToastProvider } from '@/components/ui/Toast';

/**
 * The authenticated shell: header, tab bar, content column.
 *
 * The session is read once here, on the server, and the tab list is filtered by
 * role before it reaches the browser — a packer is never sent the markup for
 * Settings. Middleware still enforces the same rule on the route itself; this is
 * only about not showing doors that will not open.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = session.user.role;
  const items = NAV.filter((item) => atLeast(role, item.minRole));

  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-4 border-b border-line bg-black px-4 py-3">
          <Image
            src="/logo-small.png"
            alt="Jelly Bean Genius"
            width={38}
            height={48}
            priority
            className="h-10 w-auto drop-shadow-[0_0_8px_rgba(78,207,154,0.25)]"
          />
          <NavTabs items={items} />
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs font-semibold text-muted">
              {session.user.name} · {role}
            </span>
            <SignOutButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-shell px-4 pt-6 pb-20">{children}</main>
      </div>
    </ToastProvider>
  );
}
