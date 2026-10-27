import type { SupabaseClient } from "@supabase/supabase-js";

import { funcaoDaTela } from "@/lib/iavek/funcoes";
import { ehLojaDeCarros, lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

/**
 * ia.vek v1.9.3 — O SDR MARCA DIRETO (decisão do Rodrigo, 27/10, CRM-208).
 *
 * Na LOJA (perfil loja de carros, fora do modo agendamento), quem tem a função
 * "sdr" marca o agendamento escolhendo o VENDEDOR: o compromisso nasce
 * confirmado, sem passar pelo admin, e o vendedor é avisado no sino. Não segura
 * horário (a loja não tem trava). Muda a regra de 21/10 SÓ para o SDR: o
 * vendedor, o gerente, o SDR de suporte e a IA continuam PEDINDO, e o admin
 * confirma. A clínica (modo agendamento) segue a regra dela.
 *
 * A função vem do VÍNCULO no banco (que só o admin grava), nunca do corpo.
 */
export async function sdrMarcaDireto(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const [{ data: vinculo }, { data: org }] = await Promise.all([
    admin
      .from("user_organizations")
      .select("interface_settings")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle(),
    admin.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
  ]);
  const funcao = funcaoDaTela((vinculo?.interface_settings as { funcao?: unknown } | null)?.funcao);
  if (funcao !== "sdr") return false;
  const perfil = lerPerfilDaEmpresa((org as { settings?: unknown } | null)?.settings);
  return ehLojaDeCarros(perfil) && !perfil.modo_agendamento;
}

export interface VendedorDaLoja {
  id: string;
  nome: string;
}

/** Os vendedores ativos da empresa (função "vendedor"), por nome. */
export async function vendedoresDaLoja(
  admin: SupabaseClient,
  orgId: string,
): Promise<VendedorDaLoja[]> {
  const { data } = await admin
    .from("user_organizations")
    .select("user_id, interface_settings")
    .eq("organization_id", orgId)
    .is("revoked_at", null)
    .not("accepted_at", "is", null);
  const ids = (data ?? [])
    .filter((v) => funcaoDaTela((v.interface_settings as { funcao?: unknown } | null)?.funcao) === "vendedor")
    .map((v) => v.user_id as string);
  if (ids.length === 0) return [];
  const nomes = await nomesDosAtendentes(ids);
  return ids
    .map((id) => ({ id, nome: nomes.get(id) ?? "—" }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}
