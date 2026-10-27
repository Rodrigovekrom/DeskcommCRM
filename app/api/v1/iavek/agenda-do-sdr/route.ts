/**
 * GET /api/v1/iavek/agenda-do-sdr — ia.vek v1.9.3.
 *
 * Diz à tela de agendamento se quem está conectado MARCA DIRETO (SDR da loja)
 * e, se marca, a lista dos vendedores para escolher. Para os demais:
 * `{ marca_direto: false, vendedores: [] }` — a tela segue no "Pedir agendamento".
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { sdrMarcaDireto, vendedoresDaLoja } from "@/lib/iavek/sdr-marca-direto";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const marcaDireto = await sdrMarcaDireto(admin, authz.org.orgId, authz.user.id);
  return ok(
    { marca_direto: marcaDireto, vendedores: marcaDireto ? await vendedoresDaLoja(admin, authz.org.orgId) : [] },
    { requestId },
  );
}
