/**
 * The repository layer. Components and route handlers import from here; nobody
 * imports Prisma directly, so the query surface stays in one place and the
 * schema can move without a rename sweep through the screens.
 */
export { prisma } from './client';
export * from './settings.repo';
export * from './products.repo';
export * from './aliases.repo';
export * from './batches.repo';
export * from './boxes.repo';
export * from './printJobs.repo';
export * from './quotes.repo';
export * from './users.repo';
