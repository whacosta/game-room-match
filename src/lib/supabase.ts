import { createClient } from '@supabase/supabase-js'

// La publishable key es pública por diseño: se envía al navegador y la
// autorización real vive en las políticas RLS de Supabase.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://fxoirkfapcssoawjoasn.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_HPVbjKzQtlr-P4L_FBLJgg_RDT1vWWR'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
