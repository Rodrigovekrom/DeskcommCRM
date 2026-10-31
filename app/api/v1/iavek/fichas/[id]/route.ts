/**
 * /api/v1/iavek/fichas/[id] — ia.vek v1.7.8.
 *
 * GET    os DADOS e os documentos da ficha — só vendedor dono, analista e
 *        admin; cada leitura vira linha em iavek_ficha_leituras.
 * PATCH  o vendedor corrige e reenvia quando a analista pediu documento
 *        (`{ dados }`): a ficha volta para "enviada".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { conferirDados, quemNaFicha, type CampoDaFicha } from "@/lib/iavek/fichas";
import { analistasDaOrg, avisar, exigeVerDados, lerFicha, registrarLeitura, semAcesso } from "@/lib/iavek/fichas-servidor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const portao = await quemNaFicha(requestId);
  if (!portao.ok) return portao.response;
  const quem = portao.quem;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return semAcesso(quem, requestId);
  const ficha = await lerFicha(quem.orgId, id);
  if (!ficha || !exigeVerDados(quem, ficha)) return semAcesso(quem, requestId);

  const { data: docs } = await createAdminClient()
    .from("iavek_ficha_documentos")
    .select("id, tipo, nome, mime, tamanho, created_at")
    .eq("organization_id", quem.orgId)
    .eq("ficha_id", id)
    .order("created_at");
  await registrarLeitura(quem, id, "dados");

  return ok(
    {
      id: ficha.id,
      lead_id: ficha.lead_id,
      titulo_do_lead: ficha.titulo_do_lead,
      status: ficha.status,
      motivo: ficha.motivo,
      campos: ficha.campos,
      dados: ficha.dados,
      anonimizada: ficha.anonimizada,
      decidida_em: ficha.decidida_em,
      created_at: ficha.created_at,
      documentos: docs ?? [],
      pode_decidir: quem.analista || quem.admin,
      pode_corrigir: !quem.analista && ficha.status === "pendente_documento",
    },
    { requestId },
  );
}

const correcaoSchema = z.object({ dados: z.record(z.string(), z.unknown()) }).strict();

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const portao = await quemNaFicha(requestId);
  if (!portao.ok) return portao.response;
  const quem = portao.quem;
  const t = (s: string) => traduzir(s, quem.idioma);
  const { id } = await ctx.params;
  if (quem.analista || quem.suporteSoLeitura || !z.uuid().safeParse(id).success) return semAcesso(quem, requestId);
  const ficha = await lerFicha(quem.orgId, id);
  if (!ficha || !exigeVerDados(quem, ficha)) return semAcesso(quem, requestId);
  if (ficha.status !== "pendente_documento") {
    return fail("state_conflict", t("Só dá para corrigir a ficha quando a analista pede documento."), 409, { requestId });
  }
  const corpo = correcaoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
  const campos = (Array.isArray(ficha.campos) ? ficha.campos : []) as CampoDaFicha[];
  const { dados, problemas } = conferirDados(campos, corpo.data.dados);
  if (problemas.length > 0) {
    return fail("validation_failed", t("A ficha tem campos a corrigir."), 422, { requestId, details: { problemas } });
  }
  const { data: gravada } = await createAdminClient()
    .from("iavek_fichas")
    .update({ dados, status: "enviada", updated_at: new Date().toISOString() })
    .eq("organization_id", quem.orgId)
    .eq("id", id)
    .eq("status", "pendente_documento")
    .select("id")
    .maybeSingle();
  if (!gravada) return fail("state_conflict", t("A ficha mudou enquanto você editava. Recarregue."), 409, { requestId });
  void avisar(quem.orgId, await analistasDaOrg(quem.orgId), "ficha_enviada", ficha.lead_id, quem.userId, { reenvio: true });
  void audit({
    action: "iavek.ficha_reenviada",
    actorUserId: quem.userId,
    organizationId: quem.orgId,
    resourceType: "iavek_fichas",
    resourceId: id,
    requestId,
  });
  return ok({ id, status: "enviada" }, { requestId });
}
