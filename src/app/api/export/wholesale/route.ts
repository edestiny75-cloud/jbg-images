import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { can } from '@/lib/auth/roles';
import { MAX_SELECTION, buildPriceBook, exportFilename } from '@/lib/export/priceBook';
import { resolveDocument } from '@/lib/export/selection';
import { XLSX_CONTENT_TYPE, toXlsx } from '@/lib/export/xlsx';

/**
 * The wholesale export.
 *
 * A Route Handler rather than a Server Action because the answer is a file, not
 * a re-render: the browser gets bytes and a filename and does what it does with
 * downloads. The client sends a description of the slice it wants and receives a
 * finished workbook — no spreadsheet library is loaded in the browser at all.
 *
 * Prices, and especially cost, are manager business. The proxy has already
 * turned away anyone without a session; the role check is here because the
 * proxy deliberately knows nothing about what a route means.
 */

const bodySchema = z.object({
  shape: z.enum(['brief', 'full']).default('brief'),
  skus: z.array(z.string().min(1).max(128)).max(MAX_SELECTION).optional(),
  line: z.string().max(128).optional(),
  size: z.string().max(32).optional(),
  q: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!can.plan(session?.user.role)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'That is not a valid export request.' }, { status: 400 });
  }

  const { shape, ...query } = parsed.data;
  const { items, settings, scope } = await resolveDocument(query);

  if (items.length === 0) {
    return NextResponse.json({ error: 'Nothing matched — there is no sheet to build.' }, { status: 422 });
  }

  const buffer = await toXlsx(buildPriceBook(items, { shape, settings }), 'Wholesale');
  const filename = exportFilename(scope, 'xlsx');

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': XLSX_CONTENT_TYPE,
      // exportFilename slugifies to ASCII, so the plain form needs no encoding.
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
