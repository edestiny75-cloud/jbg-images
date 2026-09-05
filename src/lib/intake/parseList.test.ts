import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ListParseError, parseListFile } from './parseList';

/**
 * The real customer files carry a title block above the table and a trailing
 * summary row, which is why the header is found by looking for "ASIN" rather
 * than assuming row 1.
 */
async function workbook(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Request');
  for (const row of rows) ws.addRow(row);
  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

const HEADER = ['ASIN', 'Title', 'SKU', 'Requested Qty', 'Notes'];

describe('parseListFile', () => {
  it('reads a plain sheet', async () => {
    const buf = await workbook([HEADER, ['B01', 'Laundry Today', 'JBG-POS-LAM-A', 12, 'rush']]);
    const { lines, skipped } = await parseListFile(buf, 'list.xlsx');

    expect(skipped).toBe(0);
    expect(lines).toEqual([
      { sku: 'JBG-POS-LAM-A', asin: 'B01', title: 'Laundry Today', requested: 12, notes: 'rush' },
    ]);
  });

  it('finds the header below a title block', async () => {
    const buf = await workbook([
      ['Inventory Request — JAMS 25'],
      [],
      HEADER,
      ['B02', 'Presidents', 'JBG-BIN-LAM-Lincoln', 5, ''],
    ]);
    const { lines } = await parseListFile(buf, 'list.xlsx');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.sku).toBe('JBG-BIN-LAM-Lincoln');
  });

  it('counts rows that have content but no SKU', async () => {
    const buf = await workbook([HEADER, ['B03', 'X', 'JBG-A', 1, ''], ['', '', '', '', 'subtotal']]);
    const { lines, skipped } = await parseListFile(buf, 'list.xlsx');
    expect(lines).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('treats an unparseable quantity as zero rather than NaN', async () => {
    const buf = await workbook([HEADER, ['B04', 'X', 'JBG-A', 'twelve', '']]);
    const { lines } = await parseListFile(buf, 'list.xlsx');
    expect(lines[0]?.requested).toBe(0);
  });

  it('strips the thousands separator from a quantity', async () => {
    const buf = await workbook([HEADER, ['B05', 'X', 'JBG-A', '1,200', '']]);
    const { lines } = await parseListFile(buf, 'list.xlsx');
    expect(lines[0]?.requested).toBe(1200);
  });

  it('rejects a sheet with no SKU column', async () => {
    const buf = await workbook([['ASIN', 'Title', 'Qty'], ['B06', 'X', 3]]);
    await expect(parseListFile(buf, 'list.xlsx')).rejects.toBeInstanceOf(ListParseError);
  });

  it('rejects a sheet whose only rows have no SKU', async () => {
    const buf = await workbook([HEADER, ['', '', '', '', '']]);
    await expect(parseListFile(buf, 'list.xlsx')).rejects.toBeInstanceOf(ListParseError);
  });

  it('reads a CSV', async () => {
    const csv = `${HEADER.join(',')}\nB07,Wifi Poster,JBG-POS-LAM-Wifi,7,\n`;
    const buf = new TextEncoder().encode(csv).buffer as ArrayBuffer;
    const { lines } = await parseListFile(buf, 'list.csv');
    expect(lines[0]).toMatchObject({ sku: 'JBG-POS-LAM-Wifi', requested: 7 });
  });

  it('reports a readable error for a file that is not a spreadsheet', async () => {
    const buf = new TextEncoder().encode('not a spreadsheet').buffer as ArrayBuffer;
    await expect(parseListFile(buf, 'notes.xlsx')).rejects.toThrow(/Could not read notes\.xlsx/);
  });
});
