import 'server-only';
import { prisma } from './client';

/**
 * Wholesale quotes.
 *
 * Were the `jbg_quotes` localStorage key (index.html:1418) — an object keyed by
 * SKU, holding an unbounded array of `{customer, qty, price, date}` per product,
 * on whichever device happened to build the quote. Nobody else could see them,
 * and clearing the iPad's cache erased the lot.
 *
 * Prisma's Decimal never leaves this module: the screens and the printed
 * document get plain numbers, the same way `listPrices` already works.
 */

export interface QuoteLineInput {
  productSku: string;
  title?: string | null;
  qty: number;
  unitPrice: number;
}

export interface QuoteLineView {
  id: number;
  productSku: string;
  title: string | null;
  qty: number;
  unitPrice: number;
  /** qty × unitPrice, computed here so no caller has to remember to. */
  lineTotal: number;
}

export interface QuoteView {
  id: string;
  number: number;
  customer: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  lines: QuoteLineView[];
  total: number;
}

/** Summary row for the quotes list. */
export interface QuoteSummary {
  id: string;
  number: number;
  customer: string | null;
  createdAt: Date;
  createdBy: string | null;
  lineCount: number;
  total: number;
}

function num(v: { toNumber(): number }): number {
  return v.toNumber();
}

export async function listQuotes(limit = 25): Promise<QuoteSummary[]> {
  const rows = await prisma.quote.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { lines: { select: { qty: true, unitPrice: true } } },
  });

  return rows.map((q) => ({
    id: q.id,
    number: q.number,
    customer: q.customer,
    createdAt: q.createdAt,
    createdBy: q.createdBy,
    lineCount: q.lines.length,
    total: q.lines.reduce((sum, l) => sum + l.qty * num(l.unitPrice), 0),
  }));
}

export async function getQuote(id: string): Promise<QuoteView | null> {
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { lines: { orderBy: { id: 'asc' } } },
  });
  if (!quote) return null;

  const lines: QuoteLineView[] = quote.lines.map((l) => ({
    id: l.id,
    productSku: l.productSku,
    title: l.title,
    qty: l.qty,
    unitPrice: num(l.unitPrice),
    lineTotal: l.qty * num(l.unitPrice),
  }));

  return {
    id: quote.id,
    number: quote.number,
    customer: quote.customer,
    notes: quote.notes,
    createdAt: quote.createdAt,
    createdBy: quote.createdBy,
    lines,
    total: lines.reduce((sum, l) => sum + l.lineTotal, 0),
  };
}

export async function createQuote(
  input: { customer?: string | null; notes?: string | null; createdBy?: string | null },
  lines: readonly QuoteLineInput[],
): Promise<{ id: string; number: number }> {
  const quote = await prisma.quote.create({
    data: {
      customer: input.customer ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
      lines: {
        create: lines.map((l) => ({
          productSku: l.productSku,
          title: l.title ?? null,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      },
    },
    select: { id: true, number: true },
  });
  return quote;
}

export async function deleteQuote(id: string): Promise<void> {
  await prisma.quote.delete({ where: { id } });
}

/** One appearance of a product on a quote, newest first. */
export interface QuoteMention {
  quoteId: string;
  number: number;
  customer: string;
  qty: number;
  unitPrice: number;
  createdAt: Date;
}

/**
 * What each product has been quoted at, keyed by SKU.
 *
 * Replaces `quoteLogHtml` (index.html:1421), which read the same history out of
 * localStorage and so showed a different answer on every device. Bounded by
 * quote count rather than by product, because the product modal opens for one
 * SKU at a time but the catalog page loads them all at once.
 */
export async function quoteHistoryBySku(recentQuotes = 200): Promise<Map<string, QuoteMention[]>> {
  const quotes = await prisma.quote.findMany({
    orderBy: { createdAt: 'desc' },
    take: recentQuotes,
    include: { lines: true },
  });

  const bySku = new Map<string, QuoteMention[]>();
  for (const quote of quotes) {
    for (const line of quote.lines) {
      const mentions = bySku.get(line.productSku) ?? [];
      mentions.push({
        quoteId: quote.id,
        number: quote.number,
        customer: quote.customer ?? 'Customer',
        qty: line.qty,
        unitPrice: num(line.unitPrice),
        createdAt: quote.createdAt,
      });
      bySku.set(line.productSku, mentions);
    }
  }
  return bySku;
}
