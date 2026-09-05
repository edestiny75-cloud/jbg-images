import 'server-only';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { ListLine } from '@/lib/domain';

/**
 * Read a customer's inventory-request spreadsheet.
 *
 * Ported from `onListFile` (index.html:1820), which did this in the browser
 * with SheetJS 0.18.5 — 881 KB of the 1.39 MB base64 vendor blob, and a version
 * that predates the fix for CVE-2023-30533. Parsing happens on the server now,
 * so none of that ships to the iPad.
 *
 * The header row is found by looking for a cell that reads "ASIN", because
 * these files routinely carry a title block above the table.
 */

export interface ParsedList {
  lines: ListLine[];
  /** Rows skipped for having no SKU, reported so a mangled file is obvious. */
  skipped: number;
}

export class ListParseError extends Error {}

/** Column matchers, in the order the legacy tool applied them. */
const COLUMNS = {
  sku: (h: string) => h.includes('sku'),
  asin: (h: string) => h.includes('asin'),
  title: (h: string) => h.includes('title'),
  requested: (h: string) => h.includes('request') || h === 'qty' || h.includes('quantity'),
  notes: (h: string) => h.includes('note'),
} as const;

export async function parseListFile(buffer: ArrayBuffer, fileName: string): Promise<ParsedList> {
  const workbook = new ExcelJS.Workbook();

  try {
    if (/\.csv$/i.test(fileName)) {
      const text = new TextDecoder().decode(buffer);
      await workbook.csv.read(Readable.from([text]));
    } else {
      await workbook.xlsx.load(buffer);
    }
  } catch {
    throw new ListParseError(`Could not read ${fileName}. Save it as .xlsx or .csv and try again.`);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ListParseError('That file has no sheets in it.');

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values;
    // ExcelJS pads index 0; cells can be rich text or formula results.
    rows.push((Array.isArray(values) ? values.slice(1) : []).map(cellText));
  });

  const headerIndex = rows.findIndex((r) => r.some((c) => c.trim().toUpperCase() === 'ASIN'));
  const header = (rows[headerIndex < 0 ? 0 : headerIndex] ?? []).map((c) => c.trim().toLowerCase());
  const at = (match: (h: string) => boolean) => header.findIndex(match);

  const iSku = at(COLUMNS.sku);
  const iAsin = at(COLUMNS.asin);
  const iTitle = at(COLUMNS.title);
  const iQty = at(COLUMNS.requested);
  const iNotes = at(COLUMNS.notes);

  if (iSku < 0) {
    throw new ListParseError('No SKU column found. The sheet needs a column whose header contains "SKU".');
  }

  const lines: ListLine[] = [];
  let skipped = 0;

  for (let r = (headerIndex < 0 ? 0 : headerIndex) + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const sku = (row[iSku] ?? '').trim();
    if (!sku) {
      if (row.some((c) => c.trim() !== '')) skipped++;
      continue;
    }
    lines.push({
      sku,
      asin: iAsin >= 0 ? (row[iAsin] ?? '').trim() || null : null,
      title: iTitle >= 0 ? (row[iTitle] ?? '').trim() || null : null,
      requested: iQty >= 0 ? toQty(row[iQty]) : 0,
      notes: iNotes >= 0 ? (row[iNotes] ?? '').trim() || null : null,
    });
  }

  if (lines.length === 0) throw new ListParseError('No SKU rows found in that file.');
  return { lines, skipped };
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  const obj = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }>; hyperlink?: string };
  if (Array.isArray(obj.richText)) return obj.richText.map((t) => t.text ?? '').join('');
  if (obj.text != null) return String(obj.text);
  if (obj.result != null) return String(obj.result);
  return '';
}

function toQty(raw: string | undefined): number {
  const n = Number.parseInt(String(raw ?? '').replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
