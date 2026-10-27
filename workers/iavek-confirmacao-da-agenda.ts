import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { espacarEnvio } from "@/lib/automation/throttle";
import { textoDaConfirmacao } from "@/lib/iavek/agenda-da-ia";
import { agendaDaIaDaOrg } from "@/lib/iavek/perfil-da-empresa-servidor";
import { logger } from "@/lib/logger";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ia.vek v1.9.2 — a CONFIRMAÇÃO pelo WhatsApp quando a clínica confirma um
 * pré-agendado (`appointment.confirmed`, emitido só na passagem pendente →
 * confirmado: `gatilhoDaTransicao`, lib/agenda/laco.ts).
 *
 * Só no MODO AGENDAMENTO. Fora dele (a loja) não faz nada — a Fenômenos não
 * manda mensagem nenhuma a mais.
 *
 * O mesmo caminho e as mesmas regras do lembrete (`app/api/v1/cron/agenda-
 * reminder`): transacional (não é campanha), contato bloqueado ou sem telefone
 * não recebe, canal WORKING da empresa, espaçamento anti-banimento e a janela de
 * envio do canal. Fora da janela, NÃO reenvia depois: a confirmação é de agora,
 * e o lembrete do tipo (se ligado) cobre a véspera.
 */
export type ResultadoDaConfirmacao =
  | { status: "ok"; detail: string }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

export async function confirmarPeloWhatsApp(row: {
  organization_id: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
}): Promise<ResultadoDaConfirmacao> {
  const org = row.organization_id;
  const id = row.entity_id ?? (typeof row.payload?.appointment_id === "string" ? row.payload.appointment_id : null);
  if (!org || !id) return { status: "skipped", reason: "evento_sem_compromisso" };
  try {
    if (!(await agendaDaIaDaOrg(org)).modo) return { status: "skipped", reason: "fora_do_modo_agendamento" };
    const admin = createAdminClient();
    const { data: compromisso } = await admin
      .from("calendar_appointments")
      .select("id, status, starts_at, title, time_zone, contact_id, calendar_event_types(name)")
      .eq("id", id)
      .eq("organization_id", org)
      .maybeSingle();
    const c = compromisso as
      | { status: string; starts_at: string; title: string; time_zone: string | null; contact_id: string | null; calendar_event_types: { name: string } | null }
      | null;
    if (!c) return { status: "skipped", reason: "compromisso_sumiu" };
    if (c.status !== "confirmed") return { status: "skipped", reason: "nao_esta_mais_confirmado" };
    if (new Date(c.starts_at).getTime() <= Date.now()) return { status: "skipped", reason: "ja_passou" };
    if (!c.contact_id) return { status: "skipped", reason: "sem_contato" };

    const { data: contato } = await admin
      .from("contacts")
      .select("id, display_name, phone_number, is_blocked")
      .eq("id", c.contact_id)
      .eq("organization_id", org)
      .maybeSingle();
    if (!contato) return { status: "skipped", reason: "contato_fora_da_org" };
    if (contato.is_blocked) return { status: "skipped", reason: "contato_bloqueado" };
    if (!contato.phone_number) return { status: "skipped", reason: "sem_telefone" };

    const { data: canal } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", org)
      .eq("status", "WORKING")
      .limit(1)
      .maybeSingle();
    if (!canal) return { status: "skipped", reason: "sem_canal" };
    if (await adiarAteAJanelaAbrir(admin, org, canal.id)) return { status: "skipped", reason: "fora_da_janela" };

    const { data: organizacao } = await admin.from("organizations").select("locale").eq("id", org).maybeSingle();
    const corpo = textoDaConfirmacao({
      idioma: normalizarIdioma((organizacao as { locale?: string | null } | null)?.locale),
      nome: (contato.display_name as string | null) ?? null,
      procedimento: c.calendar_event_types?.name ?? c.title,
      inicio: new Date(c.starts_at),
      fuso: c.time_zone ?? "America/Sao_Paulo",
    });
    await espacarEnvio(canal.id);
    const conversaId = await ensureConversation(admin, org, contato.id as string, canal.id);
    await sendMessageHandler(
      admin,
      { organization_id: org, actor: { type: "webhook_source", id }, requestId: `iavek-confirmacao:${id}` },
      { conversation_id: conversaId, type: "text", body: corpo } as Parameters<typeof sendMessageHandler>[2],
    );
    return { status: "ok", detail: "confirmação enviada" };
  } catch (err) {
    // A empresa parou entre a leitura e o envio: não é erro e não volta na
    // reativação (a confirmação é de agora; o lembrete do tipo cobre a véspera).
    if (err instanceof OrgNaoOperanteError) return { status: "skipped", reason: "org_nao_operante" };
    const causa = err instanceof Error ? err.message : String(err);
    logger.warn("[iavek-confirmacao] não consegui enviar a confirmação", { organization_id: org, appointment_id: id, causa });
    return { status: "error", reason: causa.slice(0, 200) };
  }
}
