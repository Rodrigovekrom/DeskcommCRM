import type { SupabaseClient } from "@supabase/supabase-js";

import { ehLojaDeCarros, lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";

/** A organização é loja de carros? Só nela a venda pede valor final e data. */
export async function lojaPedeDadosDaVenda(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  return ehLojaDeCarros(lerPerfilDaEmpresa((data as { settings?: unknown } | null)?.settings));
}
