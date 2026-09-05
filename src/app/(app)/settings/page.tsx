import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { getSettings, listAliases, listProductLines, listProducts, listUsers } from '@/lib/db';
import { CARTONS } from '@/lib/domain';
import { env } from '@/lib/env';
import { slackConfigured } from '@/lib/notify/slack';
import { ChangePinPanel } from './ChangePinPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { PackingSettingsForm } from './PackingSettingsForm';
import { UsersPanel, type UserRow } from './UsersPanel';

/**
 * Settings. Ported from `viewSettings` (index.html:1163), which was a read-only
 * key/value list carrying the note "All fields editable in the live app; shown
 * read-only in the demo". They were never editable anywhere but the database.
 *
 * Two of its rows are dropped rather than reproduced: "Catalog source: Catalog
 * Dashboard.html — your master, re-synced on update" described a sync that does
 * not exist, and the Fiery hot-folder list was a static string with nothing
 * behind it. What the agent actually reads is shown instead.
 */
export const metadata = { title: 'Settings · JBG Fulfillment' };

export default async function SettingsPage() {
  const session = await auth();
  // The proxy already turns non-admins away; this is the check that matters.
  if (!can.editSettings(session?.user.role)) redirect('/catalog');

  const [settings, users, aliases, lines, products] = await Promise.all([
    getSettings(),
    listUsers(),
    listAliases(),
    listProductLines(),
    listProducts(),
  ]);

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Packing maths, accounts and notifications. Changes here affect everyone.
        </p>
      </header>

      <PackingSettingsForm settings={settings} />

      <UsersPanel users={rows} currentUserId={session?.user.id ?? ''} />

      <NotificationsPanel configured={slackConfigured()} />

      <ChangePinPanel />

      <Card className="p-5">
        <h2 className="text-lg font-extrabold">Reference</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <Row term="Catalog">
            {products.length} products across {lines.length} lines
          </Row>
          <Row term="Alias table">
            {aliases.size} learned list-SKU mappings — the &ldquo;map once&rdquo; memory, taught by
            confirming a match on List Intake
          </Row>
          <Row term="Carton sizes">
            {CARTONS.join(' · ')} — 20×14×10 is the working carton, the rest are for sending
            samples out
          </Row>
          <Row term="Bundle rule">
            each SKU is one mailer and one FNSKU, so a 9-pack weighs nine sheets plus one mailer
          </Row>
          <Row term="Print files">
            <code className="font-mono text-xs break-all">{env.GCS_PRINTS_URL}</code>
          </Row>
          <Row term="Product images">
            <code className="font-mono text-xs break-all">{env.SUPABASE_PUBLIC_URL}</code>
          </Row>
        </dl>
      </Card>
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-bold text-muted">{term}</dt>
      <dd className="mb-2 sm:mb-0">{children}</dd>
    </>
  );
}
