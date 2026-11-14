/**
 * ia.vek v1.9.59 (CRM-407, desenho b83f3066, "DECIDIDO, FINAL" = a A1 do Maestro): a SDR digitou (na criação de contato
 * ou na importação) o telefone de um contato que está ESCONDIDO dela (o cliente foi para o Follow-up). Em vez de 404/409,
 * que perderia o cliente e contaria a ela que ele existe:
 *   1. NENHUM lead novo e NENHUMA mudança de etapa;
 *   2. 1 TAREFA ao responsável: o dono do lead do Follow-up; se órfão, o SDR de Follow-up ATIVO mais antigo da org; sem
 *      ele, o gerente ativo mais antigo; sem gerente, um admin ativo DA ORG (nunca o platform admin). Sem nenhum (não deve
 *      acontecer): a tarefa nasce SEM dono e sai 1 alerta no log (Lupa 215742);
 *   3. a tarefa com created_by NULO (nada que a ligue à SDR; o nome dela só no TEXTO) e NO MÁXIMO 1 aberta por
 *      (contato, SDR) por dia (o `source_kind` leva o id da SDR; nenhuma RLS olha o source_kind);
 *   4. 1 atividade 'task_created' no lead do Follow-up;
 *   5. a SDR recebe só MENSAGEM_A_SDR: sem nome e sem id.
 * Tudo com o admin (service role), sem org fixa. Erro aqui NUNCA vira o nome do cliente para a SDR: quem chama cai na
 * recusa de sempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export const MENSAGEM_A_SDR = "Este cliente está com o SDR de Follow-up; ele foi avisado.";
export const fonteDoPedido = (sdrId: string) => `iavek:sdr_pediu_contato:${sdrId}`;

type Admin = SupabaseClient;

type Quem = "sdr_followup" | "gerente" | "admin";

/** O membro ativo mais antigo da org desse tipo (determinístico: created_at, depois user_id). */
async function maisAntigo(admin: Admin, org: string, quem: Quem): Promise<string | null> {
  let q = admin
    .from("user_organizations")
    .select("user_id, created_at")
    .eq("organization_id", org)
    .is("revoked_at", null);
  if (quem === "sdr_followup") q = q.eq("role", "agent").eq("interface_settings->>funcao", "sdr_followup");
  else if (quem === "gerente") q = q.in("interface_settings->>funcao", ["gerente", "apoio"]);
  else q = q.eq("role", "admin");
  const { data, error } = await q.order("created_at", { ascending: true }).order("user_id", { ascending: true });
  if (error || !data) return null;
  let ids = (data as Array<{ user_id: string }>).map((r) => r.user_id);
  if (quem === "admin" && ids.length > 0) {
    // NUNCA o platform admin (o que entra por 'acompanhar')
    const { data: pa } = await admin.from("platform_admins").select("user_id").in("user_id", ids).is("revoked_at", null);
    const fora = new Set(((pa ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
    ids = ids.filter((id) => !fora.has(id));
  }
  return ids[0] ?? null;
}

/** Quem recebe a tarefa (o passo 2). Exportada para o teste. */
export async function responsavelDoPedido(admin: Admin, org: string, donoDoLead: string | null): Promise<string | null> {
  if (donoDoLead) return donoDoLead;
  return (
    (await maisAntigo(admin, org, "sdr_followup")) ??
    (await maisAntigo(admin, org, "gerente")) ??
    (await maisAntigo(admin, org, "admin"))
  );
}

async function nomeDaSdr(admin: Admin, sdrId: string): Promise<string> {
  try {
    const { data } = await admin.auth.admin.getUserById(sdrId);
    const meta = data?.user?.user_metadata as { full_name?: unknown } | undefined;
    return typeof meta?.full_name === "string" && meta.full_name.trim() ? meta.full_name.trim() : "Uma SDR";
  } catch {
    return "Uma SDR";
  }
}

/**
 * O contato `contatoId` está escondido desta SDR? Se sim, faz os passos 1-4 e devolve "avisado"; se não, "nao_escondido"
 * (quem chama segue o caminho de sempre). Nunca lança.
 */
export async function avisarFollowupSeEscondido(
  admin: Admin,
  org: string,
  sdrId: string,
  contatoId: string,
  agora: Date = new Date(),
): Promise<"avisado" | "nao_escondido"> {
  try {
    const { data: escondido, error } = await admin.rpc("fn_iavek_contato_escondido_da_sdr", {
      p_org: org,
      p_user: sdrId,
      p_contato: contatoId,
    });
    if (error || escondido !== true) return "nao_escondido";

    const { data: orgRow } = await admin.from("organizations").select("settings").eq("id", org).maybeSingle();
    const fu = ((orgRow as { settings?: { esteira?: { followup?: { pipeline_id?: string } } } } | null)?.settings?.esteira
      ?.followup?.pipeline_id ?? null) as string | null;
    if (!fu) return "nao_escondido";
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id, owner_user_id")
      .eq("organization_id", org)
      .eq("contact_id", contatoId)
      .eq("pipeline_id", fu)
      .in("status", ["open", "future"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const l = lead as { id: string; owner_user_id: string | null } | null;
    if (!l) return "nao_escondido";

    // 1 por (contato, SDR) por dia (o dia UTC)
    const inicioDoDia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())).toISOString();
    const { data: jaTem } = await admin
      .from("crm_tasks")
      .select("id")
      .eq("organization_id", org)
      .eq("contact_id", contatoId)
      .eq("source_kind", fonteDoPedido(sdrId))
      .in("status", ["pending", "in_progress"])
      .gte("created_at", inicioDoDia)
      .limit(1)
      .maybeSingle();
    if (jaTem) return "avisado";

    const dono = await responsavelDoPedido(admin, org, l.owner_user_id);
    if (!dono) logger.warn("sdr_pediu_contato_sem_responsavel", { organization_id: org, lead_id: l.id });
    const titulo = `${await nomeDaSdr(admin, sdrId)} pediu para falar com este cliente`;
    const { data: tarefa, error: errT } = await admin
      .from("crm_tasks")
      .insert({
        organization_id: org,
        title: titulo,
        description: "Uma SDR tentou cadastrar este cliente, que está no Follow-up. Veja se é hora de reengajar.",
        lead_id: l.id,
        contact_id: contatoId,
        assigned_to: dono,
        created_by: null,
        priority: "high",
        status: "pending",
        due_date: agora.toISOString(),
        source_kind: fonteDoPedido(sdrId),
      })
      .select("id")
      .single();
    if (errT) {
      // sem a tarefa, NÃO dizer "ele foi avisado": quem chama cai na recusa de sempre (sem nome nem id)
      logger.warn("sdr_pediu_contato_tarefa_falhou", { organization_id: org, lead_id: l.id, causa: errT.message });
      return "nao_escondido";
    }
    await admin.from("crm_lead_activities").insert({
      organization_id: org,
      lead_id: l.id,
      contact_id: contatoId,
      source_module: "tarefas",
      source_id: (tarefa as { id: string }).id,
      type: "task_created",
      actor_kind: "system",
      reason: titulo,
      payload: { origem: "sdr_pediu_contato" },
      metadata: { origem: "v1959_sdr_pediu_contato" },
      performed_at: agora.toISOString(),
    });
    return "avisado";
  } catch (e) {
    logger.warn("sdr_pediu_contato_falhou", { organization_id: org, causa: e instanceof Error ? e.message : String(e) });
    return "nao_escondido";
  }
}
