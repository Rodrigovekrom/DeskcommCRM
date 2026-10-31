/**
 * GET /api/v1/iavek/space-do-guardiao — ia.vek v1.9.7 (opção B, Rodrigo 30/10).
 *
 * Os leads em que QUEM ESTÁ CONECTADO é o guardião e que já foram passados a um
 * vendedor, com o cronômetro das horas do ciclo e se ainda dá para passar a
 * outro vendedor (a ação em si é o POST de /api/v1/iavek/passagem, tipo
 * `trocar_vendedor`, com as mesmas regras do CRM-209). Mais os que foram para o
 * Follow-up nos últimos 7 dias. O guardião é `authz.user.id`, nunca parâmetro.
 *
 * Service role (lead, contato, conversa e etapas atravessam tabelas), sempre
 * filtrando a organização à mão.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { entradaDaEsteira } from "@/lib/iavek/cronometro-72h";
import { horasDoCiclo, nascimentoDoLead } from "@/lib/iavek/passagem-servidor";
import { vendedoresDaLoja } from "@/lib/iavek/sdr-marca-direto";
import { estadoNoSpace, ordenarPorUrgencia, type LinhaDoSpace } from "@/lib/iavek/space-do-guardiao";
import { createAdminClient } from "@/lib/supabase/admin";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const HORA = 3_600_000;
const COLUNAS = "id, pipeline_id, stage_id, contact_id, owner_user_id, created_at, source_metadata";

interface LeadLido {
  id: string;
  pipeline_id: string;
  stage_id: string | null;
  contact_id: string | null;
  owner_user_id: string | null;
  created_at: string;
  source_metadata: Record<string, unknown> | null;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const eu = authz.user.id;
  const db = createAdminClient();

  try {
    const { data: org, error: eOrg } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    if (eOrg) throw new Error(eOrg.message);
    const settings = (org as { settings?: unknown } | null)?.settings;
    const entrada = entradaDaEsteira(settings);
    const horas = horasDoCiclo(settings);
    const followupId =
      (settings as { esteira?: { followup?: { pipeline_id?: string } } } | null)?.esteira?.followup?.pipeline_id ?? null;
    const compromisso = new Set(entrada?.etapas_de_compromisso ?? []);

    // Os que ele passou e seguem com um vendedor (fora do Follow-up).
    let passados = db
      .from("crm_leads")
      .select(COLUNAS)
      .eq("organization_id", orgId)
      .eq("sdr_user_id", eu)
      .eq("status", "open")
      .not("owner_user_id", "is", null)
      .neq("owner_user_id", eu)
      .limit(500);
    if (entrada) passados = passados.eq("pipeline_id", entrada.pipeline_id);
    else if (followupId) passados = passados.neq("pipeline_id", followupId);
    // E os que foram para o Follow-up nos últimos 7 dias.
    const noFollowup = followupId
      ? db
          .from("crm_leads")
          .select(COLUNAS)
          .eq("organization_id", orgId)
          .eq("sdr_user_id", eu)
          .eq("status", "open")
          .eq("pipeline_id", followupId)
          .gte("created_at", new Date(Date.now() - 7 * 24 * HORA).toISOString())
          .limit(200)
      : null;
    const [r1, r2, vendedores] = await Promise.all([passados, noFollowup, vendedoresDaLoja(db, orgId)]);
    if (r1.error) throw new Error(r1.error.message);
    if (r2?.error) throw new Error(r2.error.message);
    const leads = [...((r1.data ?? []) as LeadLido[]), ...((r2?.data ?? []) as LeadLido[])];

    const contatos = [...new Set(leads.map((l) => l.contact_id).filter((x): x is string => Boolean(x)))];
    const etapas = [...new Set(leads.map((l) => l.stage_id).filter((x): x is string => Boolean(x)))];
    const donos = [...new Set(leads.map((l) => l.owner_user_id).filter((x): x is string => Boolean(x) && x !== eu))];
    const [rc, rconv, re, nomes] = await Promise.all([
      contatos.length
        ? db.from("contacts").select("id, name, display_name").eq("organization_id", orgId).in("id", contatos)
        : Promise.resolve({ data: [], error: null }),
      contatos.length
        ? db
            .from("conversations")
            .select("id, contact_id, last_message_at")
            .eq("organization_id", orgId)
            .eq("is_group", false)
            .in("contact_id", contatos)
            .order("last_message_at", { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
      etapas.length
        ? db.from("crm_stages").select("id, name").in("id", etapas)
        : Promise.resolve({ data: [], error: null }),
      nomesDosAtendentes(donos),
    ]);
    for (const r of [rc, rconv, re]) if (r.error) throw new Error(r.error.message);
    const nomeDoCliente = new Map(
      ((rc.data ?? []) as Array<{ id: string; name: string | null; display_name: string | null }>).map((c) => [c.id, nomeDoContato(c)]),
    );
    const conversaDo = new Map<string, string>();
    for (const c of (rconv.data ?? []) as Array<{ id: string; contact_id: string }>) {
      if (!conversaDo.has(c.contact_id)) conversaDo.set(c.contact_id, c.id);
    }
    const nomeDaEtapa = new Map(((re.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));

    const agora = Date.now();
    const linhas: LinhaDoSpace[] = leads.map((l) => {
      const fim = Date.parse(nascimentoDoLead(l)) + horas * HORA;
      const estado = estadoNoSpace({
        noFollowup: Boolean(followupId) && l.pipeline_id === followupId,
        emCompromisso: Boolean(l.stage_id && compromisso.has(l.stage_id)),
        fimDasHoras: fim,
        agora,
      });
      const vendedorId = l.owner_user_id && l.owner_user_id !== eu ? l.owner_user_id : null;
      return {
        lead_id: l.id,
        contact_id: l.contact_id,
        conversation_id: l.contact_id ? conversaDo.get(l.contact_id) ?? null : null,
        cliente: l.contact_id ? nomeDoCliente.get(l.contact_id) ?? null : null,
        vendedor: vendedorId ? { id: vendedorId, nome: nomes.get(vendedorId) ?? "—" } : null,
        etapa: l.stage_id ? nomeDaEtapa.get(l.stage_id) ?? null : null,
        estado,
        fim_das_horas: new Date(fim).toISOString(),
        // As mesmas regras do CRM-209 para o guardião: dentro das horas e fora do Follow-up.
        pode_trocar: estado !== "followup" && agora < fim && Boolean(vendedorId),
      };
    });

    return ok({ horas, linhas: ordenarPorUrgencia(linhas), vendedores }, { requestId });
  } catch (erro) {
    return fail("internal_error", erro instanceof Error ? erro.message : String(erro), 500, { requestId });
  }
}
