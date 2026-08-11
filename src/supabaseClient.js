import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * `true` quando as duas variáveis públicas do Supabase estão presentes.
 * A interface usa isso para mostrar um aviso de configuração em vez de quebrar.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && typeof console !== 'undefined') {
  console.warn(
    '[Veloce] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes. ' +
      'Login e chamadas autenticadas ficarão indisponíveis até configurar o .env.',
  );
}

// Fallback inerte: mantém o módulo importável (SSR/build) sem credenciais.
// Nenhuma requisição real acontece porque a host não existe.
export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'public-anon-key-nao-configurada',
  { auth: { persistSession: isSupabaseConfigured, autoRefreshToken: isSupabaseConfigured } },
);
