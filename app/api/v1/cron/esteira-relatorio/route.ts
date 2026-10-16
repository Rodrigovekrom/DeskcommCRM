/**
 * GET /api/v1/cron/esteira-relatorio — relatório semanal das ligações da
 * esteira por vendedor (ia.vek D3). Segunda de manhã, pelo scheduler. Cobre os
 * 7 dias anteriores; vai para quem `settings.esteira.relatorio_semanal` alcança
 * (papel ou usuário), pela Central (um aviso por semana: rodar de novo não
 * duplica) e por e-mail, se a instalação tem e-mail configurado.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { sendEmail } from "@/lib/email/resend";
import { configDaEsteira, usuariosDoDestinatario } from "@/lib/esteira/config";
import { htmlDoRelatorio, montarRelatorio, textoDoRelatorio, type RegistroDaSemana, type TarefaDaSemana } from "@/lib/esteira/relatorio";
import { PREFIXO_DE_LIGACAO, DIA } from "@/lib/esteira/rodada";
import { HORARIO_PADRAO } from "@/lib/esteira/horas-uteis";
import { logger } from "@/lib/logger";
import { isoLocalComOffset } from "@/lib/tempo/agora";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, settings")
    .eq("settings->esteira->>ativa", "true");
  if (error) return fail("internal_error", "Não deu para ler as organizações.", 500, { requestId });

  const fim = new Date();
  const inicio = new Date(fim.getTime() - 7 * DIA);
  // dd/mm numérico no fuso padrão da esteira (o período vai no título, igual em todo idioma).
  const fmt = (d: Date) => {
    const iso = isoLocalComOffset(d, HORARIO_PADRAO.fuso);
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  };
  const periodo = `${fmt(inicio)} a ${fmt(new Date(fim.getTime() - DIA))}`;
  const titulo = `📊 Relatório semanal de ligações (${periodo})`;
  const paradas = new Set(await idsDeOrgsParadas(admin));
  const enviados: Array<{ organization_id: string; pessoas: number; destinatarios: number } | { organization_id: string; pulado: string }> = [];

  for (const org of (orgs ?? []) as Array<{ id: string; settings: unknown }>) {
    if (paradas.has(org.id)) continue;
    const cfg = configDaEsteira(org.settings);
    const { data: jaTem } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", org.id)
      .eq("kind", "other")
      .eq("title", titulo)
      .limit(1);
    if ((jaTem ?? []).length > 0) {
      enviados.push({ organization_id: org.id, pulado: "ja_enviado" });
      continue;
    }
    const { data: tarefas } = await admin
      .from("crm_tasks")
      .select("assigned_to, status, due_date")
      .eq("organization_id", org.id)
      .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
      .gte("created_at", inicio.toISOString())
      .lt("created_at", fim.toISOString());
    const { data: registros } = await admin
      .from("crm_lead_activities")
      .select("performed_by_user_id, payload")
      .eq("organization_id", org.id)
      .eq("type", "call_logged")
      .gte("created_at", inicio.toISOString())
      .lt("created_at", fim.toISOString());

    const ids = new Set<string>();
    for (const t of (tarefas ?? []) as TarefaDaSemana[]) if (t.assigned_to) ids.add(t.assigned_to);
    for (const r of (registros ?? []) as RegistroDaSemana[]) if (r.performed_by_user_id) ids.add(r.performed_by_user_id);
    const destinatarios = await usuariosDoDestinatario(admin, org.id, cfg.relatorioSemanal);
    for (const d of destinatarios) ids.add(d);
    const nomes = new Map<string, string>();
    const emails = new Map<string, string>();
    for (const id of ids) {
      const { data } = await admin.auth.admin.getUserById(id);
      const u = data?.user;
      if (!u) continue;
      const meta = (u.user_metadata ?? {}) as { full_name?: string; name?: string };
      nomes.set(id, meta.full_name || meta.name || u.email || "Sem nome");
      if (u.email) emails.set(id, u.email);
    }

    const linhas = montarRelatorio((tarefas ?? []) as TarefaDaSemana[], (registros ?? []) as RegistroDaSemana[], nomes, fim);
    const { error: errAviso } = await admin.from("agent_inbox_items").insert({
      organization_id: org.id,
      kind: "other",
      severity: "info",
      title: titulo,
      body: textoDoRelatorio(linhas, periodo),
    });
    // Sem o aviso gravado, a rodada não teve efeito: não manda e-mail nem audita
    // (o aviso é também a marca que impede mandar duas vezes na mesma semana).
    if (errAviso) {
      logger.warn("esteira_relatorio_aviso_falhou", { organization_id: org.id, error: errAviso.message });
      enviados.push({ organization_id: org.id, pulado: "aviso_nao_gravado" });
    } else {
      const para = destinatarios.map((d) => emails.get(d)).filter((e): e is string => Boolean(e));
      if (para.length > 0) {
        try {
          await sendEmail({
            to: para,
            subject: titulo.replace("📊 ", ""),
            html: htmlDoRelatorio(linhas, periodo),
            text: textoDoRelatorio(linhas, periodo),
          });
        } catch (err) {
          logger.warn("esteira_relatorio_email_falhou", {
            organization_id: org.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      void audit({
        action: "esteira.relatorio_semanal_enviado",
        organizationId: org.id,
        bypassedRls: true,
        resourceType: "organization",
        resourceId: org.id,
        metadata: { periodo, pessoas: linhas.length, destinatarios: destinatarios.length },
        requestId,
      });
      enviados.push({ organization_id: org.id, pessoas: linhas.length, destinatarios: destinatarios.length });
    }
  }
  return ok({ periodo, organizacoes: enviados }, { requestId });
}
