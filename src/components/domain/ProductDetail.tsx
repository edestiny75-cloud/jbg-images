'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { StatCard, StatRow } from '@/components/ui/StatCard';
import { ProductBadges } from './ProductBadges';
import {
  casePack,
  isBinderSku,
  isBundleFile,
  isRetired,
  itemOz,
  shipOz,
  sheetsFor,
  type CatalogProduct,
  type PackingSettings,
  type ProductOverrides,
  type SheetSize,
} from '@/lib/domain';
import type { ProductLineConfig } from '@/lib/db/products.repo';
import type { ReactNode } from 'react';

/**
 * The product modal body. Ported from `detailBody` (index.html:1347-1391).
 *
 * Three things changed on the way across:
 *
 *  - The case pack shown here came from a formula written inline; it now calls
 *    the same `casePack` the box planner does, so the modal and the plan can no
 *    longer disagree about how many fit in a carton.
 *  - `cfg.steps` holds raw HTML from the product_lines table and was injected
 *    verbatim. It is rendered as text here — see the note by `steps` below.
 *  - Every asset URL is resolved by the server and passed in, rather than
 *    rebuilt from three different base-URL constants.
 */

export interface ProductAssetUrls {
  /** LINECFG panel field -> URL. */
  panels: Record<string, string>;
  /** LINECFG action field -> URL. */
  actions: Record<string, string>;
  fnskuPreview: string;
  fnskuPdf: string;
  printPdf: string;
}

export interface ProductDetailProps {
  product: CatalogProduct;
  line: ProductLineConfig | null;
  size: SheetSize;
  settings: PackingSettings;
  overrides?: ProductOverrides | null;
  urls: ProductAssetUrls;
  /** Hides the print actions — the packer views products read-only. */
  hideActions?: boolean;
  /** Prices, quote buttons, whatever the screen adds below the fold. */
  children?: ReactNode;
  onSendToFiery?: () => void;
}

export function ProductDetail({
  product,
  line,
  size,
  settings,
  overrides,
  urls,
  hideActions = false,
  children,
  onSendToFiery,
}: ProductDetailProps) {
  const sheets = sheetsFor(product);
  const binder = isBinderSku(product.sku);
  const pieceWord = binder ? 'sheet' : 'poster';

  const item = itemOz(product, size, settings, overrides);
  const ship = shipOz(product, size, settings, overrides);
  const pack = casePack(product, size, settings, overrides);
  const mailer = size === '11x17' ? '13×18 mailer, 6.4 oz' : '12×9.5 mailer, 3.4 oz';

  const panels = line?.panels?.length ? line.panels : [{ label: 'Poster', field: 'thumb' }];
  const actions = (line?.actions ?? []).filter(
    (a) => !(a.field === 'pdf12x18' && !product.pdf12x18Path),
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h3 className="text-xl font-extrabold text-ink">{product.title || product.sku}</h3>
        <p className="text-sm text-muted">
          {product.meta || `${size} laminated`}
          {isRetired(product) && (
            <>
              {' '}
              <Chip tone="warn">⚠ OLD SKU — use the updated one</Chip>
            </>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <code className="rounded-xs bg-panel-2 px-2 py-1 font-mono text-xs">{product.sku}</code>
          {product.asin && (
            <a
              href={`https://www.amazon.com/dp/${encodeURIComponent(product.asin)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-pill bg-info-bg px-2.5 py-1 text-xs font-bold text-info-fg"
            >
              ASIN {product.asin} ↗
            </a>
          )}
        </p>
        <ProductBadges product={product} />
      </header>

      {sheets > 1 && (
        <p
          className={`rounded-sm border px-3 py-2 text-sm ${
            isBundleFile(product.pdfPath)
              ? 'border-success-fg/30 bg-success-bg text-success-fg'
              : 'border-danger-fg/30 bg-danger-bg text-danger-fg'
          }`}
        >
          📦 {sheets}-{pieceWord} {binder ? 'binder set' : 'bundle'} —{' '}
          {isBundleFile(product.pdfPath)
            ? `prints the ${binder ? 'binder' : 'bundle'} master`
            : 'no master file yet; add one before printing'}
        </p>
      )}

      <StatRow>
        <StatCard label="Item weight" value={`${item.toFixed(1)} oz`} />
        <StatCard label="Shipping weight" value={`${ship.toFixed(1)} oz`} hint={`item + ${mailer}`} />
        <StatCard
          label={sheets > 1 ? (binder ? 'Binder contents' : 'Bundle contents') : 'Unit'}
          value={sheets > 1 ? `${sheets} ${pieceWord}s` : `1 ${pieceWord}`}
          hint={sheets > 1 ? '1 mailer · 1 FNSKU' : '1 mailer'}
        />
        <StatCard label="Case pack" value={`${pack} per case`} hint="20×14×10 · 50 lb cap" tone="good" />
        <StatCard label="Full case weight" value={`${((pack * ship) / 16).toFixed(1)} lb`} />
      </StatRow>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {panels.map((panel) => {
          const src = urls.panels[panel.field];
          return (
            <figure key={panel.field} className="flex flex-col gap-1.5">
              <figcaption className="text-xs font-bold text-muted">{panel.label}</figcaption>
              <span className="relative block aspect-[3/4] overflow-hidden rounded-sm border border-line bg-panel-2">
                {src ? (
                  <Image src={src} alt={panel.label} fill sizes="(min-width: 640px) 30vw, 45vw" className="object-contain" />
                ) : null}
              </span>
            </figure>
          );
        })}
      </div>

      {product.fnskuPath && (
        <section className="rounded-md border border-gold/40 bg-warn-bg/50 p-3">
          <h4 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-warn-fg">
            🏷️ Amazon FNSKU — reference barcode for this model
          </h4>
          <div className="flex flex-wrap items-center gap-4">
            <span className="relative block h-24 w-32 shrink-0 overflow-hidden rounded-sm border border-line bg-panel">
              <Image src={urls.fnskuPreview} alt="FNSKU sheet" fill sizes="128px" className="object-contain" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-bold text-ink">FNSKU: {product.fnskuCode || '—'}</p>
              <p className="text-xs text-muted">
                The 30-up sheet goes to the <b>label printer</b>. The print file goes to the{' '}
                <b>Fiery</b> separately — two different printers.
              </p>
            </div>
          </div>
        </section>
      )}

      {!hideActions && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button
              key={a.field}
              size="sm"
              tone={a.primary ? 'primary' : 'ghost'}
              onClick={() => window.open(urls.actions[a.field], '_blank', 'noopener')}
            >
              {a.label}
            </Button>
          ))}
          {product.fnskuPath && (
            <Button size="sm" tone="gold" onClick={() => window.open(urls.fnskuPdf, '_blank', 'noopener')}>
              Open FNSKU sheet → label printer
            </Button>
          )}
          {product.pdfPath && onSendToFiery && (
            <Button size="sm" tone="purple" onClick={onSendToFiery}>
              🖨 Send → Fiery
            </Button>
          )}
        </div>
      )}

      {line?.steps && (
        // Rendered as text on purpose. These strings came from index.html's
        // LINECFG and contain <b> tags that were injected straight into the DOM;
        // product_lines is editable, so it is not a trusted HTML source.
        <p className="rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-muted">
          <b className="text-ink">Fiery steps: </b>
          {stripTags(line.steps)}
        </p>
      )}

      {children}
    </div>
  );
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
