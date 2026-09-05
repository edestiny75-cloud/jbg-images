import 'server-only';
import ExcelJS from 'exceljs';
import type { ExportColumn, CellValue } from './priceBook';

/**
 * Turn a column set and some rows into an .xlsx file, on the server.
 *
 * The legacy tool did this in the browser with SheetJS, which is why 881 KB of
 * vendor code was decoded and evaluated on every page load whether or not
 * anybody exported anything. ExcelJS is already a dependency here — List Intake
 * reads uploads with it — so the export costs the client nothing at all: it
 * receives a finished file.
 */

/** Excel number formats, chosen by what the column holds. */
const FORMATS: Record<NonNullable<ExportColumn['kind']>, string | undefined> = {
  money: '#,##0.00',
  number: '0.#',
  text: undefined,
};

export async function toXlsx(
  sheet: { columns: readonly ExportColumn[]; rows: ReadonlyArray<Record<string, CellValue>> },
  sheetName: string,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JBG Fulfillment';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  for (const row of sheet.rows) worksheet.addRow(row);

  const header = worksheet.getRow(1);
  header.font = { bold: true };
  // Scrolling a 265-row price book without the header is how the cost column
  // gets mistaken for the wholesale one.
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  sheet.columns.forEach((column, index) => {
    const format = FORMATS[column.kind ?? 'text'];
    if (format) worksheet.getColumn(index + 1).numFmt = format;
  });

  // ExcelJS returns its own Buffer type, declared as an ArrayBuffer.
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
