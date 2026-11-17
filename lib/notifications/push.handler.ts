import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { marcaDaSaida } from "@/lib/branding/saida";
import { canalDoEventoDesativado } from "@/lib/channels/desativado";
import { createAdminClient } from "@/lib/supabase/admin";
import { conteudoDoAviso, CORPO_NEUTRO, montarPayloadDeInbound, truncar } from "./push_payload";
import { enviarPushAoUsuario, enviarPushAosUsuarios } from "./web_push";
import { gerenciaInscrita, inscritosQueVeem } from "./quem-ve";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { REFERENCIAS_DE_AVISO } from "@/lib/ai/inbox-destino";
import { vapidPronto } from "./vapid";
import { pushDoAvisoDaCentral } from "./push-dos-avisos";
import type { PushPayload } from "./push_payload";
import { rotuloDoContato, SEM_NOME } from "@/lib/contacts/rotulo-do-contato";

export const WEB_PUSH_INBOUND_KEY = "web-push-inbound.v1";

/** ia.vek CRM-530: o que a tela de bloqueio mostra, pela config da org (`settings.iavek.push.conteudo`). */
async function conteudoDaOrg(organizationId: string) {
  try {
    const { data } = await createAdminClient()
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    return conteudoDoAviso((data as { settings?: unknown } | null)?.settings);
  } catch {
    return conteudoDoAviso(null); // em erro, o padrão ('so_nome'): o lado que mostra menos
  }
}

/**
 * ia.vek CRM-530: quem recebe o aviso de uma linha (a conversa, ou o que o aviso da Central referencia): SÓ os inscritos
 * ATIVOS que a RLS daquela tabela deixa VER aquela linha (`./quem-ve.ts`). Sem o pool, ninguém (o lado seguro).
 */
async function destinosQueVeem(organizationId: string, tabela: string, id: string): Promise<string[]> {
  try {
    return await inscritosQueVeem(getRequestPool(), organizationId, tabela, id);
  } catch {
    return [];
  }
}

async function handleInbound(row: EventRow): Promise<HandlerResult> {
  // Canal DESATIVADO (#2329): a lei do #2318 vale nos dois sentidos — o canal
  // desligado não acorda a IA e também não enche o bolso de quem está de
  // plantão com uma conversa que a inbox nem mostra. Mesma ida de
  // `channel_session_id` que o payload do `fn_emit_message_event` já traz.
  if (await canalDoEventoDesativado(createAdminClient(), row.organization_id, row.payload)) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "canal_desativado" };
  }
  const conversationId =
    (typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null) ?? null;
  const previewRaw = row.payload.body_preview;
  const preview = typeof previewRaw === "string" && previewRaw.trim() ? previewRaw : "Nova mensagem";
  const type = typeof row.payload.type === "string" ? row.payload.type : "text";
  const body = type === "text" ? preview : "Mídia";

  const marca = await marcaDaSaida(row.organization_id);
  const conteudo = await conteudoDaOrg(row.organization_id);
  const contactId = typeof row.payload.contact_id === "string" ? row.payload.contact_id : null;
  let contactName: string | null = null;
  let icon: string | null = null;
  if (contactId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("contacts")
      .select("display_name, name, phone_number, avatar_storage_path, is_anonymized, is_personal")
      .eq("id", contactId)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    const c = data as {
      display_name?: string | null;
      name?: string | null;
      phone_number?: string | null;
      avatar_storage_path?: string | null;
      is_anonymized?: boolean | null;
      is_personal?: boolean | null;
    } | null;
    // Pessoal não empurra nada no bolso (spec 21, etapa 10, caminho 3): sem push.
    if (c?.is_personal === true) {
      return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "contato_pessoal" };
    }
    // A cadeia CANÔNICA, e não a de dois campos remontada aqui: aquela deixava
    // passar o identificador técnico do WhatsApp — a notificação chegaria à tela
    // de bloqueio do celular escrita "Contato 543134@lid". `rotuloDoContato`
    // recusa identificador, cai para o telefone formatado, e só então desiste.
    //
    // (A varredura de `rotulo-do-contato.test.ts` lê o arquivo INTEIRO, comentário
    // incluído — por isso a cadeia proibida não é escrita nem aqui em prosa.)
    //
    // `SEM_NOME` volta a `null` de propósito: o payload já tem um desfecho
    // melhor para "não sei o nome" (`"Nova mensagem"`, em push_payload.ts), e
    // trocá-lo por "Sem nome" pioraria o título sem ninguém pedir.
    const rotulo = rotuloDoContato(c);
    contactName = rotulo === SEM_NOME ? null : rotulo;
    // (Lupa 190537) a foto só vai à tela de bloqueio no 'completo': nos outros modos, nem se gera a URL assinada
    if (conteudo === "completo" && c?.avatar_storage_path && !c.is_anonymized) {
      const { data: signed } = await admin.storage
        .from("whatsapp-media")
        .createSignedUrl(c.avatar_storage_path, 300);
      icon = signed?.signedUrl ?? null;
    }
  }
  if (!conversationId) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_conversa" };
  }
  const payload = montarPayloadDeInbound({
    brand: marca.nome,
    conversationId,
    preview: body,
    contactName,
    icon,
    conteudo,
  });
  // ia.vek CRM-530: SÓ a quem pode ver esta conversa (a policy conversations_select, perguntada por inscrito).
  const destinos = await destinosQueVeem(row.organization_id, "conversations", conversationId);
  const { sent } = await enviarPushAosUsuarios(row.organization_id, destinos, payload);
  return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent} destinos:${destinos.length}` };
}

/**
 * `message.group_received` — MESMO payload de `message.received` (a
 * conversa é a do GRUPO ligado, o "contato" é o placeholder de
 * `kind='whatsapp_group'`), mas nunca a cópia do 1:1: não busca nome/avatar de
 * contato (a IA não serve grupos, e a Task 8 não abre exceção só para a
 * notificação), não cria nem roteia nada — só avisa o atendente que o grupo
 * está falando. Título fixo, igual em toda organização.
 */
async function handleGroupInbound(row: EventRow): Promise<HandlerResult> {
  // Canal DESATIVADO (#2329): a mesma régua de `handleInbound` — a inbox
  // esconde o grupo do canal pausado também, e o payload é o mesmo.
  if (await canalDoEventoDesativado(createAdminClient(), row.organization_id, row.payload)) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "canal_desativado" };
  }
  const conversationId =
    (typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null) ?? null;
  const previewRaw = row.payload.body_preview;
  const preview = typeof previewRaw === "string" && previewRaw.trim() ? previewRaw : "Nova mensagem";
  const type = typeof row.payload.type === "string" ? row.payload.type : "text";
  const body = type === "text" ? preview : "Mídia";

  if (!conversationId) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_conversa" };
  }
  // ia.vek CRM-530: o texto do grupo só aparece na tela de bloqueio com a config 'completo'.
  const conteudo = await conteudoDaOrg(row.organization_id);
  const payload: PushPayload = {
    title: "Nova mensagem no grupo",
    body: conteudo === "completo" ? truncar(body) : CORPO_NEUTRO,
    tag: `msg:${conversationId}`,
    href: `/app/inbox?id=${conversationId}`,
  };
  const destinos = await destinosQueVeem(row.organization_id, "conversations", conversationId);
  const { sent } = await enviarPushAosUsuarios(row.organization_id, destinos, payload);
  return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent} destinos:${destinos.length}` };
}

/** Os avisos da Central que pedem gente — ver `./push-dos-avisos.ts`. */
async function handleAvisoQuePedeGente(row: EventRow): Promise<HandlerResult> {
  const id = typeof row.payload.item_id === "string" ? row.payload.item_id : row.entity_id;
  if (!id) return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_alvo" };
  const admin = createAdminClient();
  const doAviso = await pushDoAvisoDaCentral(admin, row.organization_id, id);
  if (doAviso === null) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "aviso_fora_do_celular" };
  }
  // (Lupa 190537) a mesma config da tela de bloqueio: o aviso da Central já sai sem dado de cliente, salvo o da proposta,
  // que nomeia a contraparte (a exceção do push-dos-avisos). No 'so_nome' isso é de propósito: o nome é permitido, e o
  // texto da mensagem nunca vai. No 'nada', o aviso também vira genérico.
  const payload: PushPayload =
    (await conteudoDaOrg(row.organization_id)) === "nada"
      ? { title: "Novo aviso na Central", body: CORPO_NEUTRO, tag: doAviso.tag, href: doAviso.href }
      : doAviso;
  // ia.vek CRM-530: o aviso vai a quem VÊ o que ele referencia (a mesma tabela que a Central abre,
  // REFERENCIAS_DE_AVISO); sem referência (ex.: a IA sem saldo, que é da loja inteira), à gerência ativa inscrita.
  const { data: item } = await admin
    .from("agent_inbox_items")
    .select("ref_kind, ref_id")
    .eq("id", id)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  const ref = item as { ref_kind?: string | null; ref_id?: string | null } | null;
  const alvo = ref?.ref_kind ? (REFERENCIAS_DE_AVISO as Record<string, { tabela: string }>)[ref.ref_kind] : undefined;
  let destinos: string[];
  if (alvo && ref?.ref_id) {
    destinos = await destinosQueVeem(row.organization_id, alvo.tabela, ref.ref_id);
  } else {
    // sem referência, OU uma referência FORA da lista (Lupa 185335): FECHA na gerência ativa inscrita, nunca a org inteira
    try {
      destinos = await gerenciaInscrita(getRequestPool(), row.organization_id);
    } catch {
      destinos = [];
    }
  }
  const { sent } = await enviarPushAosUsuarios(row.organization_id, destinos, payload);
  return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent} destinos:${destinos.length}` };
}

async function leadBits(organizationId: string, leadId: string): Promise<{
  title: string;
  ownerUserId: string | null;
  pipelineId: string | null;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("crm_leads")
    .select("title, owner_user_id, pipeline_id")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = data as {
    title?: string | null;
    owner_user_id?: string | null;
    pipeline_id?: string | null;
  } | null;
  return {
    title: row?.title?.trim() || "Lead",
    ownerUserId: row?.owner_user_id ?? null,
    pipelineId: row?.pipeline_id ?? null,
  };
}

function hrefDoLead(pipelineId: string | null): string {
  return pipelineId ? `/app/pipelines/${pipelineId}` : "/app/kanban";
}

async function enviarParaUsuario(
  organizationId: string,
  userId: string | null,
  payload: PushPayload,
): Promise<HandlerResult> {
  if (!userId) {
    return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_destinatario" };
  }
  const { sent } = await enviarPushAoUsuario(organizationId, userId, payload);
  return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "ok", detail: `sent:${sent}` };
}

export const webPushInboundHandler: EventHandler = {
  key: WEB_PUSH_INBOUND_KEY,
  naOrgParada: "pula",
  events: [
    "message.received",
    "message.group_received",
    "lead.assigned",
    "lead.won",
    "lead.lost",
    "user.mentioned",
    // Os avisos que pedem gente (migration 0442) — ver `./push-dos-avisos.ts`.
    "central.aviso_criado",
  ],
  async handle(row): Promise<HandlerResult> {
    if (!vapidPronto()) {
      return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "vapid_ausente" };
    }
    if (row.event_type === "message.received") return handleInbound(row);
    if (row.event_type === "message.group_received") return handleGroupInbound(row);
    if (row.event_type === "central.aviso_criado") return handleAvisoQuePedeGente(row);

    if (row.event_type === "user.mentioned") {
      const toUserId = typeof row.payload.to_user_id === "string" ? row.payload.to_user_id : null;
      const conversationId =
        typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null;
      const preview =
        typeof row.payload.body_preview === "string" ? row.payload.body_preview : "Você foi mencionado";
      return enviarParaUsuario(row.organization_id, toUserId, {
        title: "Você foi mencionado",
        body: truncar(preview),
        tag: conversationId ? `mention:${conversationId}` : "mention",
        href: conversationId ? `/app/inbox/${conversationId}` : "/app/inbox",
      });
    }

    const leadId =
      (typeof row.payload.lead_id === "string" ? row.payload.lead_id : null) ??
      (typeof row.entity_id === "string" ? row.entity_id : null);
    if (!leadId) {
      return { consumer_key: WEB_PUSH_INBOUND_KEY, status: "skipped", detail: "sem_lead" };
    }
    const lead = await leadBits(row.organization_id, leadId);
    const href = hrefDoLead(lead.pipelineId);

    if (row.event_type === "lead.assigned") {
      const toUserId = typeof row.payload.to_user_id === "string" ? row.payload.to_user_id : lead.ownerUserId;
      return enviarParaUsuario(row.organization_id, toUserId, {
        title: "Lead atribuído a você",
        body: truncar(lead.title),
        tag: `lead-assigned:${leadId}`,
        href,
      });
    }
    if (row.event_type === "lead.won") {
      return enviarParaUsuario(row.organization_id, lead.ownerUserId, {
        title: "Lead ganho",
        body: truncar(lead.title),
        tag: `lead-won:${leadId}`,
        href,
      });
    }
    return enviarParaUsuario(row.organization_id, lead.ownerUserId, {
      title: "Lead perdido",
      body: truncar(lead.title),
      tag: `lead-lost:${leadId}`,
      href,
    });
  },
};
