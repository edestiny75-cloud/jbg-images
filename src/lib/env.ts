import 'server-only';
import { z } from 'zod';

/**
 * Server environment. Validated once at module load so a missing variable
 * fails the build rather than the request that happens to need it.
 *
 * Nothing here is `NEXT_PUBLIC_*` on purpose: the legacy tool shipped a
 * Supabase anon key to the browser, which is what gave anyone with the URL
 * full read/write on every table.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),

  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required (npx auth secret)'),
  AUTH_URL: z.string().url().optional(),

  SLACK_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  PRINT_AGENT_TOKEN: z.string().optional().or(z.literal('')),

  GCS_PRINTS_URL: z.string().url().default('https://storage.googleapis.com/jbg-print-files-2026/'),
  SUPABASE_PUBLIC_URL: z
    .string()
    .url()
    .default('https://ajwzfhddyhkdoosomuaz.supabase.co/storage/v1/object/public'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
export type Env = z.infer<typeof schema>;
