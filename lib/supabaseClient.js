import { createClient } from "@supabase/supabase-js";

// A single shared connection to your Supabase database.
// The URL + key are read from .env.local (these are the public client keys — safe in the app).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
