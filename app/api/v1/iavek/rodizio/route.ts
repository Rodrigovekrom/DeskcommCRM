/**
 * /api/v1/iavek/rodizio — ia.vek v1.7.7. Só o admin.
 *
 * GET   a configuração (ligado? quem participa, em que ordem), os membros que
 *       podem participar e quantos leads sem dono há no funil padrão.
 * PATCH `{ ativo?, participantes? }` — liga/desliga e marca quem participa.
 *       Participante tem de ser membro ATIVO (agent ou acima).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { comRodizio, configDoRodizioSchema, lerRodizio } from "@/lib/iavek/rodizio";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

async function membrosQuePodemParticipar(orgId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_organizations")
    .select("user_id, role, interface_settings")
    .eq("organization_id", orgId)
    .is("revoked_at", null)
    .in("role", ["agent", "manager", "admin"]);
  return ((data ?? []) as Array<{ user_id: string; role: string; interface_settings: { funcao?: string } | null }>).map(
    (m) => ({ user_id: m.user_id, role: m.role, funcao: m.interface_settings?.funcao ?? null }),
  );
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const admin = createAdminClient();

  const [{ data: org }, membros, { data: fila }, { data: funil }] = await Promise.all([
    admin.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
    membrosQuePodemParticipar(orgId),
    admin.rpc("fn_iavek_rodizio_fila", { p_org: orgId }),
    admin.from("crm_pipelines").select("id").eq("organization_id", orgId).eq("is_default", true).maybeSingle(),
  ]);
  const cfg = lerRodizio(org?.settings);
  const nomes = await nomesDosAtendentes(membros.map((m) => m.user_id));
  const ultimaVez = new Map(
    ((fila ?? []) as Array<{ user_id: string; ultima_vez: string | null }>).map((f) => [f.user_id, f.ultima_vez]),
  );

  let semDono = 0;
  if (funil?.id) {
    const { count } = await admin
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("pipeline_id", funil.id)
      .eq("status", "open")
      .is("owner_user_id", null)
      .is("owner_agent_id", null);
    semDono = count ?? 0;
  }

  return ok(
    {
      ativo: cfg.ativo,
      participantes: cfg.participantes,
      membros: membros.map((m) => ({
        ...m,
        nome: nomes.get(m.user_id) ?? null,
        participa: cfg.participantes.includes(m.user_id),
        ultima_vez: ultimaVez.get(m.user_id) ?? null,
      })),
      sem_dono: semDono,
    },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const corpo = configDoRodizioSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  const admin = createAdminClient();
  const { data: org, error } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error || !org) return fail("internal_error", t("Não consegui ler a configuração."), 500, { requestId });
  const atual = lerRodizio(org.settings);

  let participantes = atual.participantes;
  if (corpo.data.participantes) {
    const validos = new Set((await membrosQuePodemParticipar(orgId)).map((m) => m.user_id));
    const fora = corpo.data.participantes.filter((p) => !validos.has(p));
    if (fora.length > 0) {
      return fail("validation_failed", t("Só membros ativos da equipe podem participar do rodízio."), 422, { requestId });
    }
    participantes = [...new Set(corpo.data.participantes)];
  }
  const novo = { ativo: corpo.data.ativo ?? atual.ativo, participantes };

  const { error: erroGravar } = await admin
    .from("organizations")
    .update({ settings: comRodizio(org.settings, novo) })
    .eq("id", orgId);
  if (erroGravar) return fail("internal_error", t("Não consegui gravar a configuração."), 500, { requestId });

  void audit({
    action: "iavek.rodizio_config_changed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organizations",
    resourceId: orgId,
    requestId,
    metadata: { antes: atual, depois: novo },
  });
  return ok(novo, { requestId });
}
