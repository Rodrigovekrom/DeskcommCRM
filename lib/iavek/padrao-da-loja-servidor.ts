import type { SupabaseClient } from "@supabase/supabase-js";

import { avaliarLead, lerPadraoDaLoja, resumo, type ItemAvaliado, type PadraoDaLoja } from "./padrao-da-loja";

/** O que o VENDEDOR mandou: humano pela tela ou pelo próprio celular. IA e automação não contam. */
const ENVIADO_POR_GENTE = ["crm", "user", "external_device"];

export interface LeadDoPadrao {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  owner_user_id: string | null;
  assigned_at: string | null;
  created_at: string;
  custom_fields: Record<string, unknown> | null;
}

export async function carregarPadrao(admin: SupabaseClient, orgId: string): Promise<PadraoDaLoja> {
  const { data } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  return lerPadraoDaLoja(data?.settings);
}

/**
 * Avalia um lote de leads (já AUTORIZADOS por quem chama — a rota lê os leads
 * pela sessão, e a RLS decide quais existem para a pessoa). Conta a mídia por
 * CONTATO, somando as conversas dele. Só ids, contagens e nomes de item saem
 * daqui: nenhum texto de mensagem.
 */
export async function avaliarLeads(
  admin: SupabaseClient,
  orgId: string,
  padrao: PadraoDaLoja,
  leads: LeadDoPadrao[],
): Promise<Map<string, { itens: ItemAvaliado[]; pendentes: number; fora: number; fotos: number; videos: number }>> {
  const saida = new Map<string, { itens: ItemAvaliado[]; pendentes: number; fora: number; fotos: number; videos: number }>();
  if (leads.length === 0 || padrao.itens.length === 0) return saida;

  const funis = [...new Set(leads.map((l) => l.pipeline_id))];
  const { data: etapas } = await admin
    .from("crm_stages")
    .select("id, position")
    .eq("organization_id", orgId)
    .in("pipeline_id", funis);
  const posicao = new Map(((etapas ?? []) as Array<{ id: string; position: number }>).map((e) => [e.id, Number(e.position)]));

  const contatos = [...new Set(leads.map((l) => l.contact_id).filter((c): c is string => Boolean(c)))];
  const porContato = new Map<string, { fotos: number; videos: number }>();
  if (contatos.length > 0) {
    const { data: conversas } = await admin
      .from("conversations")
      .select("id, contact_id")
      .eq("organization_id", orgId)
      .in("contact_id", contatos);
    const contatoDa = new Map(((conversas ?? []) as Array<{ id: string; contact_id: string }>).map((c) => [c.id, c.contact_id]));
    if (contatoDa.size > 0) {
      const { data: midias } = await admin
        .from("messages")
        .select("conversation_id, type")
        .eq("organization_id", orgId)
        .in("conversation_id", [...contatoDa.keys()])
        .eq("direction", "outbound")
        .in("type", ["image", "video"])
        .in("sent_via", ENVIADO_POR_GENTE)
        .limit(20000);
      for (const m of (midias ?? []) as Array<{ conversation_id: string; type: string }>) {
        const c = contatoDa.get(m.conversation_id);
        if (!c) continue;
        const atual = porContato.get(c) ?? { fotos: 0, videos: 0 };
        if (m.type === "image") atual.fotos += 1;
        else atual.videos += 1;
        porContato.set(c, atual);
      }
    }
  }

  for (const l of leads) {
    const midia = (l.contact_id && porContato.get(l.contact_id)) || { fotos: 0, videos: 0 };
    const itens = avaliarLead(padrao, l, midia, posicao);
    saida.set(l.id, { itens, ...resumo(itens), ...midia });
  }
  return saida;
}

export const COLUNAS_DO_LEAD_DO_PADRAO =
  "id, title, pipeline_id, stage_id, contact_id, owner_user_id, assigned_at, created_at, custom_fields";
