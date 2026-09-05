'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/ui/cn';
import type { NavItem } from '@/lib/nav';

const TONES: Record<string, string> = {
  blue: 'bg-jbg-blue',
  pink: 'bg-jbg-pink',
  orange: 'bg-jbg-orange',
  purple: 'bg-jbg-purple',
  green: 'bg-jbg-green',
  gold: 'bg-jbg-gold',
  teal: 'bg-jbg-teal',
  red: 'bg-jbg-red',
};

/**
 * The tab bar. Real links, so the back button, refresh and deep links all work —
 * the legacy tool had no routing at all: `go()` assigned `STATE.view` and
 * re-rendered, and had exactly one call site.
 */
export function NavTabs({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-sm px-3 py-2 text-sm font-extrabold text-white',
              'transition-[filter] hover:brightness-110',
              TONES[item.tone] ?? 'bg-panel-2',
              active && 'outline-2 -outline-offset-2 outline-white brightness-115',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
