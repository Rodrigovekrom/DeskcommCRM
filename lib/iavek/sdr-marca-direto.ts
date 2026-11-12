import type { SupabaseClient } from "@supabase/supabase-js";

import { funcaoDaTela } from "@/lib/iavek/funcoes";
import { ehLojaDeCarros, lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

/**
 * ia.vek v1.9.48 — NA LOJA, TODOS MARCAM DIRETO (decisão do Rodrigo, 06/11 e 10/11, CRM-255/257:
 * "todos agendam, sem passo intermediário").
 *
 * Antes (v1.9.3, 27/10, CRM-208) só a função "sdr" marcava: o vendedor, o gerente e o apoio caíam no
 * PEDIDO e esperavam um admin (achado de 12/11: 2 pedidos de vendedor pendentes há um dia). A 0613
 * abriu a Agenda e a decisão do pedido para a equipe, mas o botão "Agendar horário" seguia esta regra.
 *
 * Agora: na LOJA (perfil loja de carros, fora do modo agendamento), QUALQUER membro ativo marca direto
 * — escolhe o vendedor, o compromisso nasce confirmado. A CLÍNICA (modo agendamento) segue a regra
 * dela, e a IA segue PEDINDO (`IA_AGENDA_SOZINHA`, lib/mcp/tools/agendamento.ts). NÃO volte a olhar a
 * função aqui: tests/unit/iavek-v1948-todos-agendam.test.ts fica vermelho.
 *
 * `ehSdr` NÃO decide quem marca: só diz se quem marcou vira o GUARDIÃO do lead (o guardião é sempre
 * quem tem a função "sdr", como no gatilho 0579). O vínculo e a função vêm do banco, nunca do corpo.
 */
export async function marcaDiretoNaLoja(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<{ marcaDireto: boolean; ehSdr: boolean }> {
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
  if (!vinculo) return { marcaDireto: false, ehSdr: false };
  const ehSdr = funcaoDaTela((vinculo.interface_settings as { funcao?: unknown } | null)?.funcao) === "sdr";
  const perfil = lerPerfilDaEmpresa((org as { settings?: unknown } | null)?.settings);
  return { marcaDireto: ehLojaDeCarros(perfil) && !perfil.modo_agendamento, ehSdr };
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

/**
 * Pacote de segurança (31/10): ao marcar para o vendedor, o SDR passa o lead SEM
 * dono, o DELE e o que ele GUARDA. O de outra pessoa da loja, só a gerência.
 */
export function podePassarOLead(
  lead: { owner_user_id: string | null; sdr_user_id: string | null },
  eu: string,
): boolean {
  return lead.owner_user_id === null || lead.owner_user_id === eu || lead.sdr_user_id === eu;
}
