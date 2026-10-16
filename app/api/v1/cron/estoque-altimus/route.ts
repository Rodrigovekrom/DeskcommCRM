/**
 * GET /api/v1/cron/estoque-altimus
 *
 * Sincroniza o estoque do Altimus com o catálogo de produtos (ia.vek D2). Chamada
 * de hora em hora pelo cron do servidor, com o mesmo cabeçalho das outras rotas de
 * cron (`Authorization: Bearer <INTERNAL_CRON_SECRET>`, fail-closed).
 *
 * Sem `ALTIMUS_ESTOQUE_URL` configurada (Admin › Configuração › Integrações), a
 * rodada não faz nada e responde `configurado: false` — e não audita: rodada que
 * não fez nada não é mutação. A que mudou o catálogo audita uma linha com as
 * contagens (nunca a URL, que carrega a chave de acesso).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { depsReais, organizacaoUnica } from "@/lib/estoque/deps-reais";
import { rodadaTeveEfeito, sincronizarEstoque } from "@/lib/estoque/sincronizar";
import { valorDaInstalacao } from "@/lib/instalacao/config";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const url = (await valorDaInstalacao("ALTIMUS_ESTOQUE_URL")).valor?.trim() ?? "";
  if (url === "") return ok({ configurado: false }, { requestId });
  if (!url.startsWith("https://")) {
    return fail("validation_error", "ALTIMUS_ESTOQUE_URL precisa começar com https://.", 422, { requestId });
  }

  const orgId = await organizacaoUnica();
  if (orgId === null) {
    return fail(
      "conflict",
      "A sincronização do estoque exige exatamente uma organização nesta instalação.",
      409,
      { requestId },
    );
  }

  // Organização parada (suspensa/cancelada) não recebe sincronização: o catálogo
  // dela fica como está até ela voltar a operar.
  if ((await idsDeOrgsParadas(createAdminClient())).includes(orgId)) {
    return ok({ configurado: true, pulado: "organizacao_parada" }, { requestId });
  }

  const resumo = await sincronizarEstoque(orgId, depsReais(orgId, url));

  if (rodadaTeveEfeito(resumo)) {
    void audit({
      action: "catalog.estoque_altimus_sincronizado",
      organizationId: orgId,
      bypassedRls: true,
      resourceType: "catalog_products",
      metadata: { ...resumo },
      requestId,
    });
  }

  return ok({ configurado: true, ...resumo }, { requestId });
}
