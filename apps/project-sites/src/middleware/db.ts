/**
 * Database middleware
 * Initializes Supabase client and Stripe client
 */
import type { MiddlewareHandler } from 'hono';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { AppEnv } from '../types.js';

export const dbMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Initialize Supabase client with service role for server-side operations
  const supabase = createClient(
    c.env.SUPABASE_URL,
    c.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  // Initialize Stripe client
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-04-10',
    typescript: true,
  });

  c.set('db', supabase);
  c.set('stripe', stripe);

  await next();
};
