import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH /api/v1/leads/[id] — update lead (handler em ../_handler.ts).
 *
 * Aceita sessão de navegador OU token de servidor (`dsk_…` com `mcp:write`),
 * mesma dualidade de `/api/v1/messages`: a integração de monitoramento
 * processual (n8n consultando Escavador/Jusbrasil/Codilo/Judit) atualiza o
 * campo personalizado "Andamento atual" por aqui, sem navegador. A org nunca
 * vem do corpo — no ramo do token ela sai da linha do token
 * (`lib/api/auth-dual.ts`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { recusaEtiquetaNova } from "@/lib/iavek/etiquetas";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { updateLeadSchema, validateRequest } from "@/lib/schemas";

import { updateLeadHandler } from "../_handler";
import { trocaResponsavel } from "@/lib/iavek/funcoes";
import { funcaoNaOrganizacao } from "@/lib/iavek/contato-no-alcance";
import { ehLojaDeCarros, lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import { fecharAutomaticasDaPassagem, tarefasDePessoaAbertas } from "@/lib/iavek/passagem-servidor";
import { REGRAS_DA_PASSAGEM } from "@/lib/iavek/regras-da-passagem";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: "agent",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const { supabase, organizationId, actor, idioma } = authz;

  const tetoEstourado = await tetoDeEscritaDoToken(authz, "leads", requestId);
  if (tetoEstourado) return tetoEstourado;

  let input;
  try {
    input = await validateRequest(updateLeadSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // ia.vek v1.7.6: etiqueta NOVA só o admin cria (quem entra pela tela; token
  // de integração segue o escopo dele).
  if (authz.via === "session") {
    const etiquetaNova = await recusaEtiquetaNova({
      supabase,
      orgId: organizationId,
      tags: input.tags,
      requestId,
      idioma,
    });
    if (etiquetaNova) return etiquetaNova;
  }

  // ia.vek CRM-244 (Fase 1): pela TELA, o vendedor não troca o responsável. A função é lida no
  // banco (nunca do corpo) e só quando o pedido mexe no dono; o handler recusa se o dono MUDAR.
  const mexeNoDono = "owner_user_id" in input || "owner_agent_id" in input;
  const iavekTrocaResponsavel =
    authz.via === "session" && mexeNoDono && actor.type === "user"
      ? trocaResponsavel(await funcaoNaOrganizacao(supabase, organizationId, actor.id))
      : undefined;

  // ia.vek v1.9.62 (CRM-497, D4 1A + P1 do Rodrigo): na LOJA, a PESSOA que troca o dono pelo quadro também resolve
  // antes as tarefas de pessoa abertas do lead (o mesmo 409 da passagem). Só quando o dono MUDA de verdade; o token de
  // integração e a clínica ficam como antes. O ponto único da regra: lib/iavek/regras-da-passagem.ts.
  let passouPeloQuadro = false;
  if (
    REGRAS_DA_PASSAGEM.trocaPeloQuadroExigeTarefasResolvidas &&
    authz.via === "session" &&
    actor.type === "user" &&
    "owner_user_id" in input
  ) {
    const admin = createAdminClient();
    const [{ data: atual }, { data: org }] = await Promise.all([
      admin.from("crm_leads").select("owner_user_id, status").eq("organization_id", organizationId).eq("id", leadId).maybeSingle(),
      admin.from("organizations").select("settings").eq("id", organizationId).maybeSingle(),
    ]);
    const perfil = lerPerfilDaEmpresa((org as { settings?: unknown } | null)?.settings);
    const loja = ehLojaDeCarros(perfil) && !perfil.modo_agendamento;
    const donoAtual = (atual as { owner_user_id: string | null } | null)?.owner_user_id ?? null;
    if (loja && atual && (input as { owner_user_id?: string | null }).owner_user_id !== donoAtual) {
      const abertas = await tarefasDePessoaAbertas(admin, organizationId, leadId);
      if (abertas.length > 0) {
        return fail("tarefas_abertas", traduzir("Antes de passar o lead, resolva as tarefas abertas dele.", idioma ?? "pt-BR"), 409, {
          requestId,
          details: { tarefas: abertas },
        });
      }
      passouPeloQuadro = true;
    }
  }

  try {
    const updated = await updateLeadHandler(
      supabase,
      {
        organization_id: organizationId,
        actor,
        requestId,
        idioma,
        ...(iavekTrocaResponsavel === false ? { iavekTrocaResponsavel } : {}),
      },
      leadId,
      input,
    );
    // v1.9.62 (D4): passou de mãos, as automáticas abertas fecham ('passou_o_lead')
    if (passouPeloQuadro) await fecharAutomaticasDaPassagem(createAdminClient(), organizationId, leadId);
    return ok(updated, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
