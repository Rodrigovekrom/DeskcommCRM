/**
 * POST /api/v1/iavek/medidas — ia.vek v1.9.16: a medição real por tela.
 *
 * Recebe tempos do navegador e escreve uma linha no registro do app (`[medida-de-tela]`).
 * Não grava no banco e não leva dado de cliente (`lib/iavek/medidas-de-tela.ts`).
 * Falhar aqui nunca atrapalha ninguém: o navegador não espera a resposta.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { medidaParaRegistro, medidaSchema } from "@/lib/iavek/medidas-de-tela";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const TAMANHO_MAXIMO = 4_096;

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;

  const texto = await req.text().catch(() => "");
  if (texto.length > TAMANHO_MAXIMO) return fail("validation_failed", "Medida grande demais.", 422, { requestId });
  let bruto: unknown = null;
  try {
    bruto = JSON.parse(texto);
  } catch {
    /* cai na validação abaixo */
  }
  const medida = medidaSchema.safeParse(bruto);
  if (!medida.success) return fail("validation_failed", "Medida inválida.", 422, { requestId });

  logger.info("[medida-de-tela]", {
    ...medidaParaRegistro(medida.data),
    org: authz.org.orgId,
    papel: authz.org.role,
    funcao: (authz.org.interface_settings as { funcao?: unknown } | null | undefined)?.funcao ?? null,
  });
  return ok({ recebida: true }, { requestId });
}
