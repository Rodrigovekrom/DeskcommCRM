import { fail } from "@/lib/api/wrappers";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { podeVerDados, type QuemNaFicha } from "./fichas";

/** A ficha com o dono do lead — lida pelo servidor, sempre filtrada pela org. */
export async function lerFicha(orgId: string, id: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("iavek_fichas")
    .select("id, organization_id, lead_id, contact_id, enviada_por, status, dados, campos, motivo, decidida_por, decidida_em, anonimizada, created_at, updated_at, crm_leads(owner_user_id, title)")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const lead = (Array.isArray(data.crm_leads) ? data.crm_leads[0] : data.crm_leads) as
    | { owner_user_id: string | null; title: string | null }
    | null;
  return { ...data, dono_do_lead: lead?.owner_user_id ?? null, titulo_do_lead: lead?.title ?? null };
}

/** Registro de leitura (LGPD): quem viu os dados ou o documento, e quando. */
export async function registrarLeitura(
  quem: QuemNaFicha,
  fichaId: string,
  oQue: "dados" | "documento",
  documentoId: string | null = null,
) {
  await createAdminClient()
    .from("iavek_ficha_leituras")
    .insert({ organization_id: quem.orgId, ficha_id: fichaId, user_id: quem.userId, o_que: oQue, documento_id: documentoId });
}

export function semAcesso(quem: QuemNaFicha | null, requestId: string) {
  return fail("forbidden", traduzir("Você não tem acesso a esta ficha.", quem?.idioma ?? "pt-BR"), 403, { requestId });
}

export function exigeVerDados(
  quem: QuemNaFicha,
  ficha: { enviada_por: string | null; dono_do_lead: string | null },
): boolean {
  return podeVerDados(quem, ficha, ficha.dono_do_lead);
}

/** Avisa no sino (as linhas não levam dado da ficha — só o status). */
export async function avisar(
  orgId: string,
  destinos: string[],
  tipo: "ficha_enviada" | "ficha_decidida",
  leadId: string | null,
  ator: string,
  dados: Record<string, unknown> = {},
) {
  const unicos = [...new Set(destinos)].filter((u) => u && u !== ator);
  if (unicos.length === 0) return;
  await createAdminClient()
    .from("notificacoes")
    .insert(unicos.map((u) => ({ organization_id: orgId, user_id: u, tipo, lead_id: leadId, ator_user_id: ator, dados })));
}

export async function analistasDaOrg(orgId: string): Promise<string[]> {
  const { data } = await createAdminClient()
    .from("user_organizations")
    .select("user_id, interface_settings")
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  return ((data ?? []) as Array<{ user_id: string; interface_settings: { funcao?: string } | null }>)
    .filter((m) => m.interface_settings?.funcao === "analista_ficha")
    .map((m) => m.user_id);
}
