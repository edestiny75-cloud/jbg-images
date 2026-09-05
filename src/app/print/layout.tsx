import type { ReactNode } from 'react';
import './print.css';

/**
 * The layout for printed documents: no app shell, no nav, no dark theme.
 *
 * `/print/*` sits outside the `(app)` group on purpose. These pages are opened
 * in their own tab, sent to a printer or saved as a PDF, and handed to a
 * customer — a navigation bar and an order chip have no business on them.
 *
 * They are still behind the proxy, and still behind a role: `requiredRole` in
 * src/proxy.ts matches `/print/…` against the Print Queue's NAV entry, so these
 * documents need `manager`, which is the same role the wholesale prices they
 * quote already require.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="doc">{children}</div>;
}
