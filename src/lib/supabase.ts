import { createClient } from '@supabase/supabase-js';
import config from '../config';

/**
 * Supabase client for server-side operations
 * Uses service role key for admin operations (user management, bypassing RLS)
 */
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Create a Supabase client with user context (for RLS enforcement)
 * Pass the user's JWT token from the Authorization header
 */
export function createUserClient(accessToken: string) {
  return createClient(
    config.supabase.url,
    config.supabase.anonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    }
  );
}
