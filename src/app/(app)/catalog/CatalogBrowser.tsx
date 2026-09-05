'use client';

import { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, QtyInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SearchBar } from '@/components/ui/SearchBar';
import { useToast } from '@/components/ui/Toast';
import { ProductDetail, type ProductAssetUrls } from '@/components/domain/ProductDetail';
import { ProductTile } from '@/components/domain/ProductTile';
import { QuoteLog, type ProductQuote } from '@/components/domain/QuoteLog';
import { useDocuments } from '@/lib/hooks/useDocuments';
import { useSelection } from '@/lib/hooks/useSelection';
import { isBinderSku, type CatalogProduct, type PackingSettings, type ProductOverrides, type SheetSize } from '@/lib/domain';
import type { ProductLineConfig } from '@/lib/db/products.repo';
import { queueFieryPrint } from './actions';
import { cn } from '@/lib/ui/cn';

/**
 * Browse, search, open and export the catalog. Ported from `viewCatalog`
 * (index.html:843) and its four helpers.
 *
 * The legacy screen kept a second, drifted copy of the product card inside
 * `catSearch` (:1189) which had lost the export-mode branch — so searching
 * while export mode was on fell back to a whole-screen re-render and the input
 * lost focus on every keystroke. There is one card here, and filtering runs
 * against a deferred query so the caret never waits for 265 tiles.
 *
 * Export mode itself is shorter than the original. The legacy "Review & export"
 * step (`renderExportModal`, :1205) reprinted the selection with an editable
 * wholesale price per row, because localStorage was the only place a price could
 * be typed. Prices are a table now and the Wholesale sheet edits them properly —
 * with cost, MSRP, weights and a live case pack — so checking products here
 * leads straight to the two outputs rather than through a second price editor
 * that would only disagree with the first.
 */

export interface CatalogEntry {
  product: CatalogProduct;
  line: ProductLineConfig | null;
  lineLabel: string;
  size: SheetSize;
  urls: ProductAssetUrls;
  overrides: ProductOverrides | null;
}

export interface CatalogTab {
  id: string;
  label: string;
}

export function CatalogBrowser({
  entries,
  lines,
  settings,
  canExport,
  quotes,
}: {
  entries: readonly CatalogEntry[];
  lines: readonly CatalogTab[];
  settings: PackingSettings;
  /** Prices are manager business, so the export controls are too. */
  canExport: boolean;
  /** Quote history per SKU, for the product modal. Only quoted SKUs appear. */
  quotes: Readonly<Record<string, ProductQuote[]>>;
}) {
  const { exporting, exportExcel, openPriceSheet } = useDocuments();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [activeLine, setActiveLine] = useState(() => lines[0]?.id ?? '');
  const [exportMode, setExportMode] = useState(false);
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [fierySku, setFierySku] = useState<string | null>(null);

  const selection = useSelection((e: CatalogEntry) => e.product.sku);

  const searching = deferredQuery.trim().length > 0;

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return entries.filter((e) => e.product.line === activeLine);
    return entries.filter((e) => {
      const p = e.product;
      return `${p.sku} ${p.title ?? ''} ${p.asin ?? ''} ${p.fnskuCode ?? ''}`.toLowerCase().includes(q);
    });
  }, [entries, deferredQuery, activeLine]);

  // Posters and binders are shown in separate groups so a mixed line (Civics)
  // does not interleave them. Search results stay in one list.
  const posters = visible.filter((e) => !isBinderSku(e.product.sku));
  const binders = visible.filter((e) => isBinderSku(e.product.sku));
  const grouped = !searching && posters.length > 0 && binders.length > 0;

  const open = entries.find((e) => e.product.sku === openSku) ?? null;
  const fiery = entries.find((e) => e.product.sku === fierySku) ?? null;

  /**
   * The catalog exports the checked products and nothing else — there is no
   * "everything currently filtered" fallback here, because a catalog tab is a
   * theme and exporting a whole theme is one press of Select all.
   *
   * `brief` rather than `full`: this sheet goes to a customer, and the full
   * shape carries cost.
   */
  const target = () => ({ skus: [...selection.keys] });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold">Catalog</h1>
        <p className="mt-1 text-sm text-muted">
          Browse any line and print any product manually — set copies, send to the Fiery. The
          automatic list flow lives in the other tabs.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Product lines">
        {lines.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => {
              setActiveLine(l.id);
              setQuery('');
            }}
            className={cn(
              'min-h-11 rounded-pill border px-4 text-sm font-bold transition-colors',
              activeLine === l.id && !searching
                ? 'border-mint bg-mint-dark text-mint-ink'
                : 'border-line bg-panel text-muted hover:text-ink',
            )}
          >
            {l.label}
          </button>
        ))}
      </nav>

      {exportMode ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-gold/40 bg-warn-bg/40 px-3 py-2">
            <b className="text-gold">⬇ Wholesale export</b>
            <span className="text-sm text-muted">{selection.count} selected</span>
            <Button size="sm" tone="ghost" onClick={() => selection.selectAll(visible)}>
              ☑ Select all in {searching ? 'results' : (lines.find((l) => l.id === activeLine)?.label ?? 'line')}
            </Button>
            <Button size="sm" tone="ghost" onClick={selection.clear}>
              Clear
            </Button>
            <span className="ml-auto flex gap-2">
              <Button
                size="sm"
                tone="green"
                pending={exporting}
                disabled={selection.count === 0}
                onClick={() => exportExcel(target(), 'brief', selection.count)}
              >
                ⬇ Excel ({selection.count})
              </Button>
              <Button
                size="sm"
                tone="blue"
                disabled={selection.count === 0}
                onClick={() => openPriceSheet(target())}
              >
                🖨 Price sheet ({selection.count})
              </Button>
              <Button size="sm" tone="ghost" onClick={() => setExportMode(false)}>
                Done
              </Button>
            </span>
          </div>
          <p className="text-sm text-muted">
            Tap products to check them, or a whole theme with <b>Select all</b>. Prices are set on
            the Wholesale sheet before the export.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar
            value={query}
            onQuery={setQuery}
            placeholder={`Search by name, SKU or ASIN (all ${entries.length})…`}
            aria-label="Search the catalog"
          />
          {canExport && (
            <Button size="sm" tone="gold" onClick={() => setExportMode(true)}>
              ⬇ Export catalog
            </Button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-md border border-line bg-panel px-4 py-10 text-center text-muted">
          No products {searching ? `match “${deferredQuery}”` : 'in this line'}.
        </p>
      ) : grouped ? (
        <>
          <Group title={`🖼 Posters · ${posters.length}`}>
            <Grid entries={posters} exportMode={exportMode} selection={selection} onOpen={setOpenSku} />
          </Group>
          <Group title={`📒 Binders · ${binders.length}`}>
            <Grid entries={binders} exportMode={exportMode} selection={selection} onOpen={setOpenSku} />
          </Group>
        </>
      ) : (
        <Grid entries={visible} exportMode={exportMode} selection={selection} onOpen={setOpenSku} />
      )}

      <Modal open={open !== null} onClose={() => setOpenSku(null)} size="lg" title={open?.product.sku}>
        {open && (
          <ProductDetail
            product={open.product}
            line={open.line}
            size={open.size}
            settings={settings}
            overrides={open.overrides}
            urls={open.urls}
            onSendToFiery={() => {
              setFierySku(open.product.sku);
              setOpenSku(null);
            }}
          >
            {canExport && <QuoteLog quotes={quotes[open.product.sku] ?? []} />}
          </ProductDetail>
        )}
      </Modal>

      <FieryPrompt entry={fiery} onClose={() => setFierySku(null)} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Grid({
  entries,
  exportMode,
  selection,
  onOpen,
}: {
  entries: readonly CatalogEntry[];
  exportMode: boolean;
  selection: ReturnType<typeof useSelection<CatalogEntry>>;
  onOpen: (sku: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {entries.map((entry) => (
        <ProductTile
          key={entry.product.sku}
          product={entry.product}
          onOpen={exportMode ? undefined : onOpen}
          selected={exportMode ? selection.isSelected(entry) : undefined}
          onSelect={exportMode ? (_sku, next) => selection.set(entry, next) : undefined}
        />
      ))}
    </div>
  );
}

/** Ported from `openFieryPrompt` / `confirmFiery`: how many copies, then queue. */
function FieryPrompt({ entry, onClose }: { entry: CatalogEntry | null; onClose: () => void }) {
  const { toast } = useToast();
  const [copies, setCopies] = useState<number | ''>(1);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!entry) return;
    startTransition(async () => {
      const result = await queueFieryPrint({ sku: entry.product.sku, copies: copies === '' ? 1 : copies });
      if (result.ok) {
        toast(`Queued ${result.queued} job for the Fiery.`, 'success');
        onClose();
      } else {
        toast(result.error, 'danger');
      }
    });
  };

  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      size="sm"
      title="Send to Fiery"
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" pending={pending} onClick={submit}>
            Queue print
          </Button>
        </>
      }
    >
      {entry && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            <b className="text-ink">{entry.product.title || entry.product.sku}</b>
            <br />
            {entry.size} · the agent picks this up within five seconds.
          </p>
          <Field label="Copies">
            {(id) => <QtyInput id={id} value={copies} onValueChange={setCopies} autoFocus />}
          </Field>
        </div>
      )}
    </Modal>
  );
}
