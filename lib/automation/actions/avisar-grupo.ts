/**
 * Ação `avisar_grupo` (ia.vek D4) — "Avisar grupo do WhatsApp" da equipe.
 *
 * O grupo e o número moram em `settings.aviso_grupo` (Configurações ›
 * Distribuição de atendimento); a regra escolhe só o TIPO (🎉/🚨/📊) e o texto
 * (com `{{contact.name}}`, `{{lead.title}}` etc., o mesmo template das outras
 * ações). Regras em `lib/avisos-grupo/regras.ts`.
 *
 * TRANSPORTE DIRETO, como o aviso de caso ao suporte: o aviso não é mensagem do
 * atendimento, não nasce em `messages` e não abre conversa. Ele GASTA uma
 * mensagem do número, então entra no `pacing_ledger` e respeita o espaçamento
 * do número além do espaçamento e do teto próprios do grupo.
 *
 * Contagem do dia: os runs com esta ação em `success` desde a meia-noite no
 * fuso da organização. Sem tabela nova.
 */
import { registerAction } from "@/lib/automation/actions";
import { renderTemplate } from "@/lib/automation/template";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import {
  TIPOS_DE_AVISO,
  configDoAvisoGrupo,
  decidirAviso,
  textoDoAviso,
  type AvisoGrupoSettings,
  type TipoDeAviso,
} from "@/lib/avisos-grupo/regras";
import { instanteLocal } from "@/lib/esteira/horas-uteis";
import { FUSO_PADRAO, fusoUtilizavel } from "@/lib/tempo/fusos";

export const TIPO_DA_ACAO = "avisar_grupo";

export interface DepsDoAvisoGrupo {
  agora(): Date;
  config(orgId: string): Promise<{ cfg: AvisoGrupoSettings | null; fuso: string }>;
  /** Avisos já enviados ao grupo desde `desde`, e o instante do último. */
  enviados(orgId: string, desde: Date): Promise<{ total: number; ultimo: Date | null }>;
  /** O número pode mandar agora? (espaçamento/teto do NÚMERO). Null = pode. */
  numeroLiberaEm(orgId: string, sessionId: string, agora: Date): Promise<Date | null>;
  enviar(orgId: string, cfg: AvisoGrupoSettings, texto: string): Promise<void>;
}

function inicioDoDia(agora: Date, fuso: string): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  return instanteLocal(Number(p.year), Number(p.month), Number(p.day), "00:00", fuso);
}

function tipoDe(config: Record<string, unknown>): TipoDeAviso | null {
  return (TIPOS_DE_AVISO as readonly string[]).includes(String(config.tipo)) ? (config.tipo as TipoDeAviso) : null;
}

/** Quando adiar o evento (espaçamento do grupo ou do número). Null = seguir. */
export async function adiarAvisoAte(ctx: ActionCtx, deps: DepsDoAvisoGrupo): Promise<string | null> {
  const { cfg, fuso } = await deps.config(ctx.organizationId);
  if (!cfg) return null; // sem configuração: o execute pula e diz por quê
  const agora = deps.agora();
  const { total, ultimo } = await deps.enviados(ctx.organizationId, inicioDoDia(agora, fuso));
  const d = decidirAviso({ agora, ultimoEnvio: ultimo, enviadosHoje: total, cfg });
  if (d.tipo === "adiar") return d.ate.toISOString();
  if (d.tipo === "teto_atingido") return null; // o execute pula
  const numero = await deps.numeroLiberaEm(ctx.organizationId, cfg.channel_session_id, agora);
  return numero ? numero.toISOString() : null;
}

export async function executarAvisoGrupo(
  ctx: ActionCtx,
  config: Record<string, unknown>,
  deps: DepsDoAvisoGrupo,
): Promise<ActionResultDetail> {
  const tipo = tipoDe(config);
  const modelo = typeof config.texto === "string" ? config.texto : "";
  if (!tipo || modelo.trim() === "") return { type: TIPO_DA_ACAO, status: "failed", error: "missing_config" };
  const { cfg, fuso } = await deps.config(ctx.organizationId);
  if (!cfg) return { type: TIPO_DA_ACAO, status: "skipped", detail: { reason: "grupo_nao_configurado" } };
  const agora = deps.agora();
  const { total, ultimo } = await deps.enviados(ctx.organizationId, inicioDoDia(agora, fuso));
  const d = decidirAviso({ agora, ultimoEnvio: ultimo, enviadosHoje: total, cfg });
  if (d.tipo === "teto_atingido") {
    return { type: TIPO_DA_ACAO, status: "skipped", detail: { reason: "teto_diario", teto: cfg.teto_diario } };
  }
  const corpo = renderTemplate(modelo, ctx.context).trim();
  if (corpo === "") return { type: TIPO_DA_ACAO, status: "skipped", detail: { reason: "texto_vazio" } };
  const texto = textoDoAviso(tipo, corpo);
  try {
    await deps.enviar(ctx.organizationId, cfg, texto);
  } catch (err) {
    return { type: TIPO_DA_ACAO, status: "failed", error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
  return { type: TIPO_DA_ACAO, status: "success", detail: { tipo, caracteres: texto.length } };
}

export function depsReaisDoAvisoGrupo(ctx: ActionCtx): DepsDoAvisoGrupo {
  const admin = ctx.admin;
  return {
    agora: () => new Date(),
    async config(orgId) {
      const { data } = await admin.from("organizations").select("settings, timezone").eq("id", orgId).maybeSingle();
      const linha = data as { settings?: unknown; timezone?: string | null } | null;
      return { cfg: configDoAvisoGrupo(linha?.settings), fuso: fusoUtilizavel(linha?.timezone ?? null, FUSO_PADRAO) };
    },
    async enviados(orgId, desde) {
      const { data } = await admin
        .from("automation_rule_runs")
        .select("created_at")
        .eq("organization_id", orgId)
        .gte("created_at", desde.toISOString())
        .contains("actions_result", [{ type: TIPO_DA_ACAO, status: "success" }])
        .order("created_at", { ascending: false })
        .limit(500);
      const linhas = (data ?? []) as Array<{ created_at: string }>;
      return { total: linhas.length, ultimo: linhas[0] ? new Date(linhas[0].created_at) : null };
    },
    async numeroLiberaEm(orgId, sessionId, agora) {
      const { criarPacingDoCanal } = await import("@/lib/agent-engine/pacing/ledger-supabase");
      const d = await (await criarPacingDoCanal(admin)).decide(orgId, sessionId, agora);
      return d.liberado ? null : new Date(d.liberaEm);
    },
    async enviar(orgId, cfg, texto) {
      const { getAdapter, resolveSessionRef, CHANNEL_SESSION_REF_COLUMNS } = await import("@/lib/channels");
      const { data } = await admin
        .from("channel_sessions")
        .select(CHANNEL_SESSION_REF_COLUMNS)
        .eq("organization_id", orgId)
        .eq("id", cfg.channel_session_id)
        .maybeSingle();
      const linha = data as Parameters<typeof resolveSessionRef>[0] | null;
      if (!linha) throw new Error("numero_do_aviso_nao_encontrado");
      const adapter = getAdapter(linha.provider as never);
      const to = await adapter.resolveRecipient({
        isGroup: true,
        groupChatId: cfg.group_chat_id,
        phoneNumber: null,
        waIdentity: null,
        waLid: null,
      });
      if (!to) throw new Error("grupo_sem_endereco_no_canal");
      await adapter.send({ organizationId: orgId, sessionRef: resolveSessionRef(linha), to, kind: "text", body: texto });
      const { criarPacingDoCanal } = await import("@/lib/agent-engine/pacing/ledger-supabase");
      await (await criarPacingDoCanal(admin)).registraEnvio(orgId, cfg.channel_session_id, new Date());
    },
  };
}

registerAction({
  type: TIPO_DA_ACAO,
  postponeUntil: (ctx) => adiarAvisoAte(ctx, depsReaisDoAvisoGrupo(ctx)),
  execute: (ctx, config) => executarAvisoGrupo(ctx, config, depsReaisDoAvisoGrupo(ctx)),
});
