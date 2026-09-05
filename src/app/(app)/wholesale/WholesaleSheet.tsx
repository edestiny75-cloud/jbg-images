'use client';

import { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MoneyInput, Select, TextInput, parseMoney } from '@/components/ui/Field';
import { Pager } from '@/components/ui/Pager';
import { SearchBar } from '@/components/ui/SearchBar';
import { useToast } from '@/components/ui/Toast';
import { Thumb } from '@/components/domain/Thumb';
import { useDocuments } from '@/lib/hooks/useDocuments';
import { useSelection } from '@/lib/hooks/useSelection';
import {
  CARTONS,
  casePack,
  itemOz,
  shipOz,
  type CatalogProduct,
  type PackingSettings,
  type SheetSize,
} from '@/lib/domain';
import { QuoteBuilder, type QuoteSeedLine } from './QuoteBuilder';
import { savePriceBook } from './actions';

/**
 * The whole catalog as one editable spreadsheet.
 *
 * Two things are deliberately different from `viewWholesale` (index.html:1322):
 *
 *  - **Edits are staged, then saved.** The legacy sheet wrote to localStorage on
 *    every keystroke. Writing to the database that way would be one round trip
 *    per character; edits collect here and go up in one transaction.
 *  - **Fields hold text.** `<input type="number">` bound through `Number()`
 *    deletes the decimal point the moment it is typed, which is why the legacy
 *    price fields fought back. `parseMoney` converts once, on save.
 *
 * Export, the printed price sheet and the quote builder all work on the same
 * target: the checked rows, or — when nothing is checked — whatever the filters
 * are currently showing. That is the legacy `wholeExportTarget()` (:1293), kept
 * because it is the right rule; what is gone is the third button beside them.
 * `exportJPEGof('wsheet', …)` (:1338) lazy-loaded html2canvas from cdnjs with no
 * integrity hash and screenshotted the table into a JPEG. A screenshot of a
 * spreadsheet is worse than the spreadsheet and worse than the price sheet, and
 * it is not worth a script tag from a third-party CDN to produce one.
 */

export interface SheetPrices {
  wholesale: string;
  cost: string;
  costBulk: string;
  msrp: string;
  map: string;
}

export interface SheetWeights {
  weightOz: string;
  shipWeightOz: string;
}

export interface SheetRow {
  product: CatalogProduct;
  lineId: string;
  lineLabel: string;
  size: SheetSize;
  thumb: string | null;
  prices: SheetPrices;
  weights: SheetWeights;
}

/** A row's staged edits, keyed by SKU. Absent means untouched. */
type Draft = SheetPrices & SheetWeights;

const PAGE_SIZES = [50, 100] as const;

export function WholesaleSheet({
  rows,
  themes,
  sizes,
  settings,
}: {
  rows: readonly SheetRow[];
  themes: ReadonlyArray<{ id: string; label: string }>;
  sizes: readonly string[];
  settings: PackingSettings;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('');
  const [size, setSize] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [quoting, setQuoting] = useState(false);

  const { exporting, exportExcel, openPriceSheet } = useDocuments();

  const selection = useSelection((row: SheetRow) => row.product.sku);

  // 265 rows re-filtered per keystroke: deferring keeps the caret ahead of it.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    return rows.filter((row) => {
      if (theme && row.lineId !== theme) return false;
      if (size && (row.product.size ?? '') !== size) return false;
      if (!q) return true;
      const hay = `${row.product.sku} ${row.product.title ?? ''} ${row.product.asin ?? ''} ${row.product.fnskuCode ?? ''} ${row.lineLabel}`;
      return hay.toLowerCase().includes(q);
    });
  }, [rows, deferredQuery, theme, size]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * perPage, current * perPage);

  const dirtyCount = Object.keys(drafts).length;
  const filtering = Boolean(query || theme || size);

  /** The row as it stands: its saved values with any staged edit on top. */
  const valueOf = (row: SheetRow): Draft =>
    drafts[row.product.sku] ?? { ...row.prices, ...row.weights };

  const edit = (row: SheetRow, key: keyof Draft, value: string) =>
    setDrafts((prev) => ({
      ...prev,
      [row.product.sku]: { ...(prev[row.product.sku] ?? { ...row.prices, ...row.weights }), [key]: value },
    }));

  const resetFilters = () => {
    setQuery('');
    setTheme('');
    setSize('');
    setPage(1);
  };

  const save = () => {
    const bySku = new Map(rows.map((r) => [r.product.sku, r]));
    const payload = Object.entries(drafts).flatMap(([sku, draft]) => (bySku.has(sku) ? [{ sku, ...draft }] : []));
    if (payload.length === 0) return;

    startTransition(async () => {
      const result = await savePriceBook({ rows: payload });
      toast(
        result.ok ? `Saved ${result.data.saved} product(s).` : result.error,
        result.ok ? 'success' : 'danger',
      );
      if (result.ok) {
        setDrafts({});
        router.refresh();
      }
    });
  };

  /**
   * What a document covers: the checked rows, else the current filter. Ported
   * from `wholeExportTarget()` — with the difference that the server resolves
   * the filter itself, so an export of "everything" is four query parameters
   * rather than 265 SKUs in a request body.
   */
  const checked = filtered.filter((row) => selection.isSelected(row));
  const target = checked.length > 0 ? checked : filtered;
  const targetQuery = () =>
    checked.length > 0
      ? { skus: checked.map((row) => row.product.sku) }
      : { ...(theme ? { line: theme } : {}), ...(size ? { size } : {}), ...(query ? { q: query } : {}) };

  /**
   * A quote seeds from the checked rows only — never from the filter. Sending a
   * customer a 265-line quote because nothing was checked is not a fallback
   * anybody wants, and the legacy builder agreed: it passed
   * `wholeSelectedItems()` with no `wholeExportTarget()` fallback.
   */
  const QUOTE_LIMIT = 200;

  const openQuote = () => {
    if (checked.length > QUOTE_LIMIT) {
      toast(`${checked.length} rows checked — a quote holds ${QUOTE_LIMIT}.`, 'warn');
      return;
    }
    setQuoting(true);
  };

  const quoteSeed = (): QuoteSeedLine[] =>
    checked.map((row) => ({
      sku: row.product.sku,
      title: row.product.title ?? row.product.sku,
      thumb: row.thumb,
      // The price as the sheet shows it, staged edits included — quoting from
      // the screen should quote what is on the screen.
      unitPrice: valueOf(row).wholesale,
    }));

  const moneyCell = (key: keyof SheetPrices, title: string) => ({
    key,
    header: title,
    width: 'w-32',
    cell: (row: SheetRow) => (
      <MoneyInput
        aria-label={`${title} for ${row.product.sku}`}
        value={valueOf(row)[key]}
        onValueChange={(v) => edit(row, key, v)}
        placeholder="0.00"
        className="min-w-24"
      />
    ),
  });

  const weightCell = (key: keyof SheetWeights, title: string, computed: (row: SheetRow) => number) => ({
    key,
    header: title,
    width: 'w-32',
    cell: (row: SheetRow) => (
      <span className="flex items-center gap-1">
        <TextInput
          aria-label={`${title} for ${row.product.sku}`}
          inputMode="decimal"
          value={valueOf(row)[key]}
          // Blank means "use the computed figure", which is what the hint shows.
          placeholder={computed(row).toFixed(1)}
          onChange={(e) => edit(row, key, e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
          className="min-w-20 text-right tabular-nums"
        />
        <span className="text-xs text-muted">oz</span>
      </span>
    ),
  });

  const columns: ReadonlyArray<Column<SheetRow>> = [
    {
      key: 'check',
      header: '',
      width: 'w-10',
      align: 'center',
      cell: (row) => (
        <label className="flex min-h-touch items-center justify-center">
          <span className="sr-only">Select {row.product.sku}</span>
          <input
            type="checkbox"
            checked={selection.isSelected(row)}
            onChange={(e) => selection.set(row, e.target.checked)}
            className="size-5 accent-mint"
          />
        </label>
      ),
    },
    {
      key: 'item',
      header: 'Item',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <Thumb sku={row.product.sku} src={row.thumb} size="sm" />
          <span className="flex flex-col">
            <b className="line-clamp-2 max-w-64">{row.product.title ?? row.product.sku}</b>
            <code className="font-mono text-xs text-muted">{row.product.sku}</code>
          </span>
        </span>
      ),
    },
    {
      key: 'fnsku',
      header: 'FNSKU',
      secondary: true,
      cell: (row) => <code className="font-mono text-xs">{row.product.fnskuCode ?? '—'}</code>,
    },
    {
      key: 'asin',
      header: 'ASIN',
      secondary: true,
      cell: (row) => <code className="font-mono text-xs">{row.product.asin ?? '—'}</code>,
    },
    { key: 'size', header: 'Size', align: 'center', width: 'w-24', cell: (row) => row.product.size ?? '—' },
    { key: 'theme', header: 'Theme', secondary: true, cell: (row) => row.lineLabel },
    moneyCell('cost', 'Cost · indiv'),
    moneyCell('costBulk', 'Cost · bulk'),
    moneyCell('wholesale', 'Wholesale'),
    moneyCell('msrp', 'MSRP'),
    weightCell('weightOz', 'Item wt', (row) => itemOz(row.product, row.size, settings)),
    weightCell('shipWeightOz', 'B2C ship wt', (row) => shipOz(row.product, row.size, settings)),
    {
      key: 'casePack',
      header: 'Case pack',
      align: 'right',
      width: 'w-24',
      cell: (row) => {
        const draft = valueOf(row);
        // Recomputed from the staged weights, so the figure moves as you type —
        // the legacy `wholeRecalc` poked a <span> by id to achieve the same.
        const pack = casePack(row.product, row.size, settings, {
          weightOz: parseMoney(draft.weightOz),
          shipWeightOz: parseMoney(draft.shipWeightOz),
          size: row.size,
        });
        return <span className="font-bold tabular-nums">{pack}</span>;
      },
    },
    { key: 'dims', header: 'Case dims', secondary: true, cell: () => CARTONS[0] },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-extrabold">Wholesale Sheet</h1>
        <p className="mt-1 text-sm text-muted">
          Every product in one spreadsheet — cost individual and bulk, wholesale, MSRP and the
          weight overrides. Edits are saved for everyone, not just this device. Leave a weight blank
          to use the computed figure shown in grey.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBar
          value={query}
          onQuery={(v) => {
            setQuery(v);
            setPage(1);
          }}
          placeholder="Find by name, SKU, FNSKU, ASIN…"
          aria-label="Search the wholesale sheet"
        />
        <Select
          aria-label="Filter by theme"
          value={theme}
          onChange={(e) => {
            setTheme(e.target.value);
            setPage(1);
          }}
          className="w-auto"
        >
          <option value="">All themes</option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by size"
          value={size}
          onChange={(e) => {
            setSize(e.target.value);
            setPage(1);
          }}
          className="w-auto"
        >
          <option value="">All sizes</option>
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {filtering && (
          <Button size="sm" tone="ghost" onClick={resetFilters}>
            ✕ Clear filter
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">
          {filtered.length} shown · {selection.count} checked
        </span>
        {selection.count > 0 && (
          <Button size="sm" tone="ghost" onClick={selection.clear}>
            Uncheck all
          </Button>
        )}
        <Button size="sm" tone="ghost" onClick={() => selection.selectAll(filtered)}>
          Check all shown
        </Button>

        <span className="mx-2 h-5 w-px bg-line" aria-hidden />

        <Button
          size="sm"
          tone="green"
          pending={exporting}
          onClick={() => exportExcel(targetQuery(), 'full', target.length)}
        >
          ⬇ Excel ({target.length})
        </Button>
        <Button size="sm" tone="blue" onClick={() => openPriceSheet(targetQuery())}>
          🖨 Price sheet ({target.length})
        </Button>
        <Button size="sm" tone="teal" disabled={checked.length === 0} onClick={openQuote}>
          🧾 Quote{checked.length > 0 && ` (${checked.length})`}
        </Button>

        <span className="ml-auto flex items-center gap-2">
          {dirtyCount > 0 && (
            <>
              <span className="text-sm font-bold text-warn-fg">
                {dirtyCount} unsaved {dirtyCount === 1 ? 'row' : 'rows'}
              </span>
              <Button size="sm" tone="ghost" disabled={pending} onClick={() => setDrafts({})}>
                Discard
              </Button>
            </>
          )}
          <Button size="sm" pending={pending} disabled={dirtyCount === 0} onClick={save}>
            Save changes
          </Button>
        </span>
      </div>

      {quoting && <QuoteBuilder seed={quoteSeed()} onClose={() => setQuoting(false)} />}

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(row) => row.product.sku}
        rowTone={(row) => (drafts[row.product.sku] ? 'warn' : undefined)}
        empty="No products match those filters."
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">Rows per page:</span>
        {PAGE_SIZES.map((n) => (
          <Button
            key={n}
            size="sm"
            tone={perPage === n ? 'default' : 'ghost'}
            onClick={() => {
              setPerPage(n);
              setPage(1);
            }}
          >
            {n}
          </Button>
        ))}
        <Pager
          className="flex-1"
          page={current}
          pageCount={pageCount}
          onPage={setPage}
          total={filtered.length}
          pageSize={perPage}
        />
      </div>
    </div>
  );
}
