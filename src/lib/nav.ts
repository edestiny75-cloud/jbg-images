import type { Route } from 'next';
import type { Role } from '@/lib/auth/roles';
import type { ButtonTone } from '@/components/ui/Button';

/**
 * The nine screens. Ported from `NAV` (index.html:832).
 *
 * The original coloured these with `nav button:nth-of-type(8n+k)`, so the ninth
 * item wrapped round to blue and inserting a tab re-coloured everything after
 * it. Each item now carries its colour, and the colour is stable.
 */
export interface NavItem {
  href: Route;
  label: string;
  tone: ButtonTone;
  /** Minimum role that may see the tab. */
  minRole: Role;
}

export const NAV: readonly NavItem[] = [
  { href: '/catalog', label: 'Catalog', tone: 'blue', minRole: 'packer' },
  { href: '/wholesale', label: 'Wholesale', tone: 'pink', minRole: 'manager' },
  { href: '/intake', label: 'List Intake', tone: 'orange', minRole: 'manager' },
  { href: '/print', label: 'Print Queue', tone: 'purple', minRole: 'manager' },
  { href: '/jobs', label: 'Print Jobs', tone: 'green', minRole: 'packer' },
  { href: '/boxes', label: 'Box Planner', tone: 'gold', minRole: 'manager' },
  { href: '/packer', label: 'Packer', tone: 'teal', minRole: 'packer' },
  { href: '/register', label: 'Box Register', tone: 'red', minRole: 'packer' },
  { href: '/settings', label: 'Settings', tone: 'blue', minRole: 'admin' },
];
