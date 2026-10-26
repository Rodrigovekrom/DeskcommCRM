/**
 * GET/PATCH /api/v1/settings/altimus — se ESTA organização é a dona do estoque
 * do Altimus (ia.vek v1.2). Mora em `organizations.settings.integracoes.altimus`.
 * Ler: gestor; gravar: admin. A URL do Altimus é da instalação e nunca passa
 * por aqui (ela carrega a chave de acesso): a resposta diz só se ela existe.
 *
 * Uma URL só não enche dois catálogos: ligar numa organização quando outra já
 * está ligada é recusado (409), em vez de o cron ter de escolher.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ehLojaDeCarros, lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import {
  altimusDaOrg,
  altimusDaOrgSchema,
  escolherOrgDona,
  settingsComAltimus,
} from "@/lib/estoque/org-dona";
import { valorDaInstalacao } from "@/lib/instalacao/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type LinhaOrg = { id: string; settings: unknown };

async function lerOrgs(): Promise<LinhaOrg[] | null> {
  const { data, error } = await createAdminClient().from("organizations").select("id, settings");
  return error || !data ? null : (data as LinhaOrg[]);
}

async function estado(orgId: string, orgs: LinhaOrg[]) {
  const url = (await valorDaInstalacao("ALTIMUS_ESTOQUE_URL")).valor?.trim() ?? "";
  const minha = orgs.find((o) => o.id === orgId);
  const dona = escolherOrgDona(orgs);
  return {
    ativa: altimusDaOrg(minha?.settings)?.ativa ?? null,
    url_configurada: url !== "",
    sincroniza_aqui:
      (dona.tipo === "marcada" || dona.tipo === "unica_sem_marca") && dona.orgId === orgId,
    outra_organizacao_ligada: orgs.some(
      (o) => o.id !== orgId && altimusDaOrg(o.settings)?.ativa === true,
    ),
  };
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_altimus" });
  if (!authz.ok) return authz.response;
  const orgs = await lerOrgs();
  if (!orgs) return fail("internal_error", "Não consegui ler a configuração.", 500, { requestId });
  return ok({ altimus: await estado(authz.org.orgId, orgs) }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "settings_altimus" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const parsed = altimusDaOrgSchema.safeParse((await req.json().catch(() => undefined)) as unknown);
  if (!parsed.success)
    return fail("validation_error", "Envie { ativa: true | false }.", 422, { requestId });

  const orgs = await lerOrgs();
  if (!orgs) return fail("internal_error", "Não consegui ler a configuração.", 500, { requestId });
  if (
    parsed.data.ativa &&
    orgs.some((o) => o.id !== orgId && altimusDaOrg(o.settings)?.ativa === true)
  ) {
    return fail(
      "state_conflict",
      "O estoque do Altimus já está ligado em outra organização. Desligue lá antes de ligar aqui.",
      409,
      { requestId },
    );
  }

  const minha = orgs.find((o) => o.id === orgId);
  // ia.vek v1.9.0: só a loja de carros recebe estoque. Ligar numa clínica faria
  // duas organizações marcadas, e o cron pararia a sincronização da loja (409).
  if (parsed.data.ativa && !ehLojaDeCarros(lerPerfilDaEmpresa(minha?.settings))) {
    return fail(
      "state_conflict",
      "O estoque do Altimus é só para loja de carros. Esta organização tem outro perfil.",
      409,
      { requestId },
    );
  }
  const proximo = settingsComAltimus(minha?.settings, parsed.data);
  const { error } = await createAdminClient()
    .from("organizations")
    .update({ settings: proximo })
    .eq("id", orgId);
  if (error) return fail("internal_error", "Não deu para salvar.", 500, { requestId });

  void audit({
    action: "estoque_altimus.config_changed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { ativa: parsed.data.ativa },
  });

  const atualizadas = orgs.map((o) => (o.id === orgId ? { ...o, settings: proximo } : o));
  return ok({ altimus: await estado(orgId, atualizadas) }, { requestId });
}
