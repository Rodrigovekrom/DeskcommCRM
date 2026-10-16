/**
 * GET /api/v1/cron/esteira-vendas
 *
 * A esteira de vendas (ia.vek D3): passagem das 72 h para o follow-up com
 * handoff, fases por dia, reengajamento, ligações L1–L7 + sinal quente e a
 * cobrança da ligação vencida (regras em `lib/esteira/rodada.ts`). Roda a cada
 * 5 minutos pelo scheduler, com o mesmo cabeçalho das outras rotas de cron.
 *
 * Só toca organização com `settings.esteira.ativa = true` e os dois funis
 * declarados — desligada é o padrão. Rodada sem efeito não audita.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { configDaEsteira } from "@/lib/esteira/config";
import { depsReaisDaEsteira } from "@/lib/esteira/deps-reais";
import { rodadaTeveEfeito, rodarEsteira, type ResumoDaRodada } from "@/lib/esteira/rodada";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const paradas = new Set(await idsDeOrgsParadas(admin));
  const resultados: Array<{ organization_id: string } & Partial<ResumoDaRodada> & { erro?: string }> = [];
  for (const org of (orgs ?? []) as Array<{ id: string; settings: unknown }>) {
    if (paradas.has(org.id)) continue;
    const cfg = configDaEsteira(org.settings);
    if (cfg.funis === null) continue;
    try {
      const resumo = await rodarEsteira(cfg, depsReaisDaEsteira(admin, org.id, () => new Date()));
      resultados.push({ organization_id: org.id, ...resumo });
      if (rodadaTeveEfeito(resumo)) {
        void audit({
          action: "esteira.rodada_executada",
          organizationId: org.id,
          bypassedRls: true,
          resourceType: "organization",
          resourceId: org.id,
          metadata: { ...resumo },
          requestId,
        });
      }
    } catch (err) {
      const erro = err instanceof Error ? err.message.slice(0, 200) : String(err);
      logger.error("esteira_rodada_falhou", { organization_id: org.id, error: erro });
      resultados.push({ organization_id: org.id, erro });
    }
  }
  return ok({ organizacoes: resultados }, { requestId });
}
