import 'server-only';
import { cache } from 'react';
import { prisma } from './client';

/**
 * Learned mappings from a customer's list SKU to a catalog SKU. Written every
 * time someone confirms a fuzzy match in Intake, which is what stops the same
 * spelling mistake needing a decision twice.
 */
export const listAliases = cache(async (): Promise<Map<string, string>> => {
  const rows = await prisma.skuAlias.findMany({ where: { productSku: { not: null } } });
  const map = new Map<string, string>();
  for (const r of rows) if (r.productSku) map.set(r.listSku, r.productSku);
  return map;
});

export async function saveAlias(listSku: string, productSku: string | null): Promise<void> {
  await prisma.skuAlias.upsert({
    where: { listSku },
    create: { listSku, productSku },
    update: { productSku },
  });
}

export async function saveAliases(entries: Iterable<[string, string | null]>): Promise<number> {
  const list = [...entries];
  if (list.length === 0) return 0;
  await prisma.$transaction(
    list.map(([listSku, productSku]) =>
      prisma.skuAlias.upsert({
        where: { listSku },
        create: { listSku, productSku },
        update: { productSku },
      }),
    ),
  );
  return list.length;
}
