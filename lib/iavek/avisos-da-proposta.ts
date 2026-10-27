/**
 * ia.vek v1.7.6 — os avisos do sino (`notificacoes`, migration 0579/0582) da
 * aprovação de proposta e do pedido de agendamento.
 *
 * Quem escreve no sino é o SERVIDOR (service role): a tabela não aceita
 * INSERT de sessão. Os avisos são best-effort — uma falha aqui nunca desfaz
 * a aprovação, a devolução ou o pedido, que já foram gravados.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Tipo =
  | "proposta_aguardando_aprovacao"
  | "proposta_aprovada"
  | "proposta_devolvida"
  | "pedido_de_agendamento"
  | "pedido_de_agendamento_confirmado"
  | "pedido_de_agendamento_recusado"
  | "agendamento_para_voce";

/** Os membros ativos da organização com um destes papéis. */
export async function membrosComPapel(
  db: SupabaseClient,
  orgId: string,
  papeis: readonly string[],
): Promise<string[]> {
  const { data, error } = await db
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .is("revoked_at", null)
    .in("role", papeis as string[]);
  if (error) return [];
  return (data ?? []).map((l) => l.user_id as string);
}

async function gravar(
  db: SupabaseClient,
  linhas: Array<{
    organization_id: string;
    user_id: string;
    tipo: Tipo;
    lead_id: string | null;
    ator_user_id: string | null;
    dados: Record<string, unknown>;
  }>,
): Promise<void> {
  if (linhas.length === 0) return;
  await db
    .from("notificacoes")
    .insert(linhas)
    .then(
      () => undefined,
      () => undefined,
    );
}

interface PropostaDoAviso {
  id: string;
  lead_id: string | null;
  aprovacao_pedida_por?: string | null;
}

/** O vendedor pediu aprovação: avisa gerentes e admins (menos quem pediu). */
export async function avisarGestoresDaAprovacao(
  db: SupabaseClient,
  args: { orgId: string; proposta: PropostaDoAviso; atorId: string },
): Promise<void> {
  const gestores = (await membrosComPapel(db, args.orgId, ["manager", "admin"])).filter(
    (u) => u !== args.atorId,
  );
  await gravar(
    db,
    gestores.map((user_id) => ({
      organization_id: args.orgId,
      user_id,
      tipo: "proposta_aguardando_aprovacao" as const,
      lead_id: args.proposta.lead_id,
      ator_user_id: args.atorId,
      dados: { proposta_id: args.proposta.id },
    })),
  );
}

/** Aprovada (enviada) ou devolvida: avisa quem pediu a aprovação. */
export async function avisarQuemPediuAprovacao(
  db: SupabaseClient,
  args: {
    orgId: string;
    proposta: PropostaDoAviso;
    atorId: string;
    tipo: "proposta_aprovada" | "proposta_devolvida";
    motivo?: string;
  },
): Promise<void> {
  const destino = args.proposta.aprovacao_pedida_por;
  if (!destino || destino === args.atorId) return;
  await gravar(db, [
    {
      organization_id: args.orgId,
      user_id: destino,
      tipo: args.tipo,
      lead_id: args.proposta.lead_id,
      ator_user_id: args.atorId,
      dados: { proposta_id: args.proposta.id, ...(args.motivo ? { motivo: args.motivo } : {}) },
    },
  ]);
}

/** Avisos do pedido de agendamento (para os admins, ou para quem pediu). */
export async function avisarSobrePedidoDeAgendamento(
  db: SupabaseClient,
  args: {
    orgId: string;
    destinos: string[];
    tipo:
      | "pedido_de_agendamento"
      | "pedido_de_agendamento_confirmado"
      | "pedido_de_agendamento_recusado";
    leadId: string | null;
    atorId: string | null;
    pedidoId: string;
    quando: string;
    motivo?: string;
  },
): Promise<void> {
  await gravar(
    db,
    args.destinos
      .filter((u) => u !== args.atorId)
      .map((user_id) => ({
        organization_id: args.orgId,
        user_id,
        tipo: args.tipo,
        lead_id: args.leadId,
        ator_user_id: args.atorId,
        dados: {
          pedido_id: args.pedidoId,
          quando: args.quando,
          ...(args.motivo ? { motivo: args.motivo } : {}),
        },
      })),
  );
}

/**
 * ia.vek v1.9.3: o SDR marcou um agendamento para o vendedor — o vendedor é
 * avisado no sino na hora (o "{who}" é o SDR; o dia e a hora vão nos dados).
 */
export async function avisarVendedorDoAgendamento(
  db: SupabaseClient,
  args: {
    orgId: string;
    vendedorId: string;
    atorId: string;
    leadId: string | null;
    appointmentId: string | null;
    quando: string;
  },
): Promise<void> {
  if (args.vendedorId === args.atorId) return;
  await gravar(db, [
    {
      organization_id: args.orgId,
      user_id: args.vendedorId,
      tipo: "agendamento_para_voce",
      lead_id: args.leadId,
      ator_user_id: args.atorId,
      dados: { appointment_id: args.appointmentId, quando: args.quando },
    },
  ]);
}
