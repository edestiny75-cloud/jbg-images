import { z } from 'zod';

/**
 * Shared by the login form and the server action that receives it, so the
 * browser and the server can never disagree about what a valid PIN is.
 */
export const loginSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(64),
  pin: z
    .string()
    .min(4, 'PIN must be at least 4 digits')
    .max(32)
    .regex(/^\d+$/, 'PIN must be digits only'),
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
