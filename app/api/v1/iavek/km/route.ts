/**
 * GET /api/v1/iavek/km?cep=&numero= — ia.vek v1.9.45 (CRM-280).
 *
 * A prévia do "Ir até o cliente": o endereço por extenso do CEP (ViaCEP) e o km de carro da loja até lá
 * (OpenRouteService). Só leitura; quem grava o km é a marcação, recalculando no servidor.
 * ia.vek v1.9.47: com LIMITE por usuário (lib/iavek/km/limite-por-usuario.ts). Passou dele, responde km nulo com o
 * motivo `limite_do_usuario` (a tela diz "Km indisponível agora; o agendamento segue normal") e nada é chamado.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ATRIBUICAO_DO_KM, normalizaCep } from "@/lib/iavek/km/calcular-km";
import { kmDaLojaAte } from "@/lib/iavek/km/km-da-loja";
import { limiteDoKm } from "@/lib/iavek/km/limite-por-usuario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const cep = normalizaCep(req.nextUrl.searchParams.get("cep") ?? "");
  if (!cep) return fail("validation_failed", "CEP inválido.", 422, { requestId });
  const numero = (req.nextUrl.searchParams.get("numero") ?? "").trim().slice(0, 20) || null;
  if (!limiteDoKm.tentar(authz.user.id)) {
    return ok({ endereco: null, km: null, motivo: "limite_do_usuario", atribuicao: null }, { requestId });
  }
  const r = await kmDaLojaAte(createAdminClient(), authz.org.orgId, { cep, numero });
  return ok({ ...r, atribuicao: r.km !== null ? ATRIBUICAO_DO_KM : null }, { requestId });
}
