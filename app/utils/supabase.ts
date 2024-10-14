import { createClient } from "@supabase/supabase-js";
import { Database } from "~/types/supabase";

export default createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);
