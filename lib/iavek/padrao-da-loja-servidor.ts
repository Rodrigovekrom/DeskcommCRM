import type { SupabaseClient } from "@supabase/supabase-js";

import { configDaEsteira } from "@/lib/esteira/config";
import { inicioDoDiaLocal, type HorarioComercial } from "@/lib/esteira/horas-uteis";
import { buscaEmLotes, IDS_POR_LOTE } from "@/lib/supabase/em-lotes";
import { todasAsPaginas } from "@/lib/supabase/paginas";

import { avaliarLead, lerPadraoDaLoja, resumo, type FatosDoLead, type ItemAvaliado, type PadraoDaLoja } from "./padrao-da-loja";

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
  horario?: HorarioComercial,
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
  // v1.9.55 (CRM-172): só busca o fato que algum item do padrão usa
  const tipos = new Set(padrao.itens.map((i) => i.tipo));
  const precisaDeRespostas = tipos.has("resposta") || tipos.has("confirmacao");
  const precisaDeVisitas = tipos.has("agendamento") || tipos.has("confirmacao");
  const precisaDaFicha = tipos.has("ficha");
  const respostasPorContato = new Map<string, number[]>(); // as saídas de GENTE (0633: sent_by_user_id), em ordem
  const visitasPorContato = new Map<string, Array<{ inicio: number; criada: number }>>();
  if (contatos.length > 0) {
    // Pacote de defeitos (D3): em LOTES (centenas de ids numa URL estouram o
    // cabeçalho) e as mídias PAGINADAS (um `.limit(20000)` para no teto do
    // PostgREST, o `max_rows`, e a contagem de fotos e vídeos mentia).
    const { data: conversas, error: erroConversas } = await buscaEmLotes(contatos, (lote) =>
      admin.from("conversations").select("id, contact_id").eq("organization_id", orgId).in("contact_id", lote),
    );
    if (erroConversas) throw new Error(`padrão da loja: conversas: ${erroConversas.message}`);
    const contatoDa = new Map((conversas as Array<{ id: string; contact_id: string }>).map((c) => [c.id, c.contact_id]));
    if (precisaDeRespostas && contatoDa.size > 0) {
      // a régua da 0633: resposta de GENTE = sent_by_user_id preenchido (nem IA, nem lembrete, campanha ou esteira)
      const desde = new Date(Math.min(...leads.map((l) => new Date(l.created_at).getTime()).filter(Number.isFinite)) - 86_400_000).toISOString();
      const ids = [...contatoDa.keys()];
      for (let i = 0; i < ids.length; i += IDS_POR_LOTE) {
        const lote = ids.slice(i, i + IDS_POR_LOTE);
        const saidas = await todasAsPaginas<{ conversation_id: string; created_at: string }>((de, ate) =>
          admin
            .from("messages")
            .select("conversation_id, created_at")
            .eq("organization_id", orgId)
            .in("conversation_id", lote)
            .eq("direction", "outbound")
            .not("sent_by_user_id", "is", null)
            .gte("created_at", desde)
            .order("id", { ascending: true })
            .range(de, ate),
        );
        for (const m of saidas) {
          const c = contatoDa.get(m.conversation_id);
          if (!c) continue;
          const lista = respostasPorContato.get(c) ?? [];
          lista.push(new Date(m.created_at).getTime());
          respostasPorContato.set(c, lista);
        }
      }
      for (const lista of respostasPorContato.values()) lista.sort((a, b) => a - b);
    }
    if (precisaDeVisitas) {
      const { data: visitas, error: erroVisitas } = await buscaEmLotes(contatos, (lote) =>
        admin
          .from("calendar_appointments")
          .select("contact_id, starts_at, created_at")
          .eq("organization_id", orgId)
          .in("contact_id", lote)
          .neq("status", "cancelled"),
      );
      if (erroVisitas) throw new Error(`padrão da loja: visitas: ${erroVisitas.message}`);
      for (const v of (visitas ?? []) as Array<{ contact_id: string; starts_at: string; created_at: string }>) {
        const lista = visitasPorContato.get(v.contact_id) ?? [];
        lista.push({ inicio: new Date(v.starts_at).getTime(), criada: new Date(v.created_at).getTime() });
        visitasPorContato.set(v.contact_id, lista);
      }
    }
    if (contatoDa.size > 0) {
      const idsDasConversas = [...contatoDa.keys()];
      const midias: Array<{ conversation_id: string; type: string }> = [];
      for (let i = 0; i < idsDasConversas.length; i += IDS_POR_LOTE) {
        const lote = idsDasConversas.slice(i, i + IDS_POR_LOTE);
        midias.push(
          ...(await todasAsPaginas<{ conversation_id: string; type: string }>((de, ate) =>
            admin
              .from("messages")
              .select("conversation_id, type")
              .eq("organization_id", orgId)
              .in("conversation_id", lote)
              .eq("direction", "outbound")
              .in("type", ["image", "video"])
              .in("sent_via", ENVIADO_POR_GENTE)
              .order("id", { ascending: true })
              .range(de, ate),
          )),
        );
      }
      for (const m of midias) {
        const c = contatoDa.get(m.conversation_id);
        if (!c) continue;
        const atual = porContato.get(c) ?? { fotos: 0, videos: 0 };
        if (m.type === "image") atual.fotos += 1;
        else atual.videos += 1;
        porContato.set(c, atual);
      }
    }
  }

  // a ficha: quem diz o que falta é o BANCO (fn_iavek_campos_que_faltam, 0590), em lote
  const fichaCompleta = new Map<string, boolean>();
  if (precisaDaFicha) {
    const ids = leads.map((l) => l.id);
    for (let i = 0; i < ids.length; i += IDS_POR_LOTE) {
      const { data, error } = await admin.rpc("fn_iavek_campos_que_faltam", { p_lead_ids: ids.slice(i, i + IDS_POR_LOTE) });
      if (error) throw new Error(`padrão da loja: ficha: ${error.message}`);
      for (const r of (data ?? []) as Array<{ lead_id: string; faltam: string[] | null }>) fichaCompleta.set(r.lead_id, (r.faltam ?? []).length === 0);
    }
  }
  // o horário da loja (o mesmo da esteira), só se algum item conta tempo útil ou dia local
  let horarioDaLoja: HorarioComercial | undefined = horario;
  if (!horarioDaLoja && precisaDeRespostas) {
    const { data: org } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    horarioDaLoja = configDaEsteira((org as { settings?: unknown } | null)?.settings).horario;
  }
  const agora = Date.now();

  for (const l of leads) {
    const midia = (l.contact_id && porContato.get(l.contact_id)) || { fotos: 0, videos: 0 };
    const fatos = fatosDoLead(l, {
      respostas: (l.contact_id && respostasPorContato.get(l.contact_id)) || [],
      visitas: (l.contact_id && visitasPorContato.get(l.contact_id)) || [],
      fichaCompleta: precisaDaFicha ? (fichaCompleta.get(l.id) ?? null) : null,
      horario: horarioDaLoja,
      agora,
    });
    const itens = avaliarLead(padrao, l, midia, posicao, agora, fatos);
    saida.set(l.id, { itens, ...resumo(itens), ...midia });
  }
  return saida;
}

/**
 * v1.9.55: os fatos de UM lead a partir do que foi buscado em lote. Exportada para o teste.
 *  - a 1ª resposta de gente DEPOIS da chegada do lead;
 *  - há visita criada depois do lead;
 *  - a visita que vale: a próxima (de hoje em diante, no fuso da loja); sem ela, a mais recente;
 *  - confirmada na véspera = houve saída de gente no DIA ANTERIOR ao da visita (fuso da loja).
 */
export function fatosDoLead(
  lead: Pick<LeadDoPadrao, "created_at">,
  b: { respostas: number[]; visitas: Array<{ inicio: number; criada: number }>; fichaCompleta: boolean | null; horario?: HorarioComercial; agora: number },
): FatosDoLead {
  const chegada = new Date(lead.created_at).getTime();
  const fuso = b.horario?.fuso ?? "America/Sao_Paulo";
  const primeira = b.respostas.find((t) => t >= chegada) ?? null;
  const temVisita = b.visitas.some((v) => v.criada >= chegada);
  const hoje = inicioDoDiaLocal(new Date(b.agora), fuso).getTime();
  const futuras = b.visitas.filter((v) => v.inicio >= hoje).sort((x, y) => x.inicio - y.inicio);
  const passadas = b.visitas.filter((v) => v.inicio < hoje).sort((x, y) => y.inicio - x.inicio);
  const escolhida = futuras[0] ?? passadas[0] ?? null;
  let visita: FatosDoLead["visita"] = null;
  if (escolhida) {
    const diaDaVisita = inicioDoDiaLocal(new Date(escolhida.inicio), fuso).getTime();
    const vespera = inicioDoDiaLocal(new Date(diaDaVisita - 1), fuso).getTime();
    visita = { inicio: escolhida.inicio, confirmadaNaVespera: b.respostas.some((t) => t >= vespera && t < diaDaVisita) };
  }
  return { primeiraRespostaDeGente: primeira, fichaCompleta: b.fichaCompleta, temVisita, visita, horario: b.horario };
}

export const COLUNAS_DO_LEAD_DO_PADRAO =
  "id, title, pipeline_id, stage_id, contact_id, owner_user_id, assigned_at, created_at, custom_fields";
