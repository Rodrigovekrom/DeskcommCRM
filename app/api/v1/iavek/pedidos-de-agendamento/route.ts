/**
 * /api/v1/iavek/pedidos-de-agendamento — ia.vek v1.7.6.
 *
 * POST  agent+ (SDR, vendedor, suporte, gerente): pede um agendamento —
 *       `{ contact_id, lead_id?, conversation_id?, quando, event_type_id?, observacao? }`.
 *       Não reserva horário. Os admins são avisados no sino.
 *       ia.vek v1.9.3: com `vendedor_id`, o SDR DA LOJA marca direto — o
 *       compromisso nasce confirmado para o vendedor escolhido, sem o admin, e o
 *       vendedor é avisado no sino. v1.9.48: na LOJA, QUALQUER membro marca assim
 *       (`marcaDiretoNaLoja`, decisão de 06/11 e 10/11); na clínica, `vendedor_id` dá 403.
 * GET   o admin vê os PENDENTES da organização (e os decididos nos últimos 30
 *       dias); os demais veem os PRÓPRIOS pedidos. v1.9.48: na LOJA (agenda livre, 0613) todos
 *       veem os PENDENTES da organização e podem decidir — a mesma regra do POST [id].
 *
 * Decidir (confirmar, recusar, cancelar) é `POST /pedidos-de-agendamento/[id]`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { marcarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import { ApiError } from "@/lib/api/types";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { traduzir } from "@/lib/i18n/dicionario";
import { avisarDonoDoAgendamento, avisarVendedorDoAgendamento } from "@/lib/iavek/avisos-da-proposta";
import {
  gravarPedidoDeAgendamento,
  pedidoDeAgendamentoSchema,
  tituloDoCompromisso,
  type PedidoGravado,
} from "@/lib/iavek/pedidos-de-agendamento";
import { modoAgendamentoDaOrg } from "@/lib/iavek/perfil-da-empresa-servidor";
import { marcaDiretoNaLoja, vendedoresDaLoja } from "@/lib/iavek/sdr-marca-direto";
import {
  CAMPOS_DA_PASSAGEM,
  camposDaPassagemSchema,
  type CamposDaPassagem,
} from "@/lib/iavek/passagem";
import {
  anotarCampos,
  lerLeadDaPassagem,
  moverParaAEtapaDaPassagem,
  passarAConversa,
  registrarPassagem,
} from "@/lib/iavek/passagem-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const DIA = 86_400_000;

const corpoSchema = pedidoDeAgendamentoSchema.extend({
  vendedor_id: z.string().uuid().optional(),
  // v1.9.4 (CRM-209): a passagem por agendamento leva os 7 campos e o contexto.
  campos: camposDaPassagemSchema.optional(),
  contexto: z.string().trim().max(2000).optional(),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const ehAdmin = roleAtLeast(authz.org.role, "admin");
  // v1.9.48: na loja, quem decide é a equipe (a mesma conta do POST /pedidos-de-agendamento/[id]).
  const podeDecidir = ehAdmin || !(await modoAgendamentoDaOrg(orgId));
  const supabase = await createClient();

  const desde = new Date(Date.now() - 30 * DIA).toISOString();
  let consulta = supabase
    .from("iavek_pedidos_de_agendamento")
    .select(
      "id, contact_id, lead_id, conversation_id, quando, event_type_id, observacao, titulo, origem, pedido_por, status, decidido_em, motivo_da_recusa, appointment_id, created_at, contacts(name, display_name, phone_number)",
    )
    .eq("organization_id", orgId)
    .or(
      ehAdmin
        ? `status.eq.pendente,created_at.gte.${desde}`
        : podeDecidir
          ? `status.eq.pendente,and(pedido_por.eq.${authz.user.id},created_at.gte.${desde})`
          : `status.eq.pendente,created_at.gte.${desde}`,
    )
    .order("quando", { ascending: true })
    .limit(200);
  if (!podeDecidir) consulta = consulta.eq("pedido_por", authz.user.id);
  const { data, error } = await consulta;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  type Linha = {
    pedido_por: string | null;
    contacts?: unknown;
  } & Record<string, unknown>;
  const linhas = (data ?? []) as unknown as Linha[];
  const nomes = await nomesDosAtendentes(
    linhas.map((l) => l.pedido_por).filter((u): u is string => Boolean(u)),
  );
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const pedidos = linhas.map(({ contacts, ...l }) => {
    const c = (Array.isArray(contacts) ? contacts[0] : contacts) as
      | { name?: string | null; display_name?: string | null; phone_number?: string | null }
      | null
      | undefined;
    return {
      ...l,
      // v1.9.48 (Lupa 113800): o contato que a RLS da v1.9.9 esconde ("cada um vê o seu") NÃO é lido pelo servidor;
      // a lista mostra o título do pedido e este rótulo no lugar do nome.
      contato_nome: c ? rotuloDoContato(c as never, t) : l.pedido_por !== authz.user.id ? t("Cliente de outra pessoa da loja") : null,
      pedido_por_nome:
        l.origem === "ia" ? t("IA") : l.pedido_por ? (nomes.get(l.pedido_por) ?? null) : null,
    };
  });
  return ok({ pedidos, pode_decidir: podeDecidir }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { vendedor_id: vendedorId, campos, contexto, ...input } = parsed.data;
  if (vendedorId) return sdrMarca(authz, input, { vendedorId, campos, contexto }, requestId);
  // v1.9.48 (decisão do Rodrigo, 12/11 12:48Z): na LOJA, pessoa da equipe NUNCA cria pedido pendente — nem quando a
  // tela, sem conseguir ler o /agenda-do-sdr, cai no "Pedir agendamento". O vendedor marca para ele mesmo; quem não é
  // vendedor escolhe o vendedor (422). A clínica segue pedindo, e a IA não passa por aqui (ela pede pelo MCP).
  {
    const admin = createAdminClient();
    if ((await marcaDiretoNaLoja(admin, authz.org.orgId, authz.user.id)).marcaDireto) {
      if ((await vendedoresDaLoja(admin, authz.org.orgId)).some((v) => v.id === authz.user.id)) {
        return sdrMarca(authz, input, { vendedorId: authz.user.id, campos, contexto }, requestId);
      }
      return fail("validation_failed", t("Escolha o vendedor."), 422, { requestId });
    }
  }

  const r = await gravarPedidoDeAgendamento(createAdminClient(), {
    orgId: authz.org.orgId,
    input,
    origem: "pessoa",
    pedidoPor: authz.user.id,
  });
  if (!r.ok) {
    const code =
      r.status === 404 ? "not_found" : r.status === 422 ? "validation_failed" : "internal_error";
    return fail(code, t(r.motivo), r.status, { requestId });
  }
  void audit({
    action: "agenda.request_created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "iavek_pedido_de_agendamento",
    resourceId: r.pedido.id,
    requestId,
  });
  return ok(r.pedido, { requestId, status: 201 });
}

type Autorizado = Extract<Awaited<ReturnType<typeof requireRole>>, { ok: true }>;

/**
 * ia.vek v1.9.3 — o SDR da loja MARCA para o vendedor escolhido. Grava o pedido
 * (o histórico do SDR e a meta seguem contando por ele) já como confirmado por
 * ele mesmo, cria o compromisso confirmado com o vendedor como responsável e
 * avisa o vendedor. Os admins não recebem pedido para confirmar.
 */
async function sdrMarca(
  authz: Autorizado,
  input: z.infer<typeof pedidoDeAgendamentoSchema>,
  passagem: { vendedorId: string; campos?: CamposDaPassagem; contexto?: string },
  requestId: string,
): Promise<Response> {
  const { vendedorId } = passagem;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const orgId = authz.org.orgId;
  const admin = createAdminClient();
  const { marcaDireto, ehSdr } = await marcaDiretoNaLoja(admin, orgId, authz.user.id);
  if (!marcaDireto) {
    return fail("forbidden_role", t("Nesta empresa o agendamento passa pelo administrador. Envie um pedido de agendamento."), 403, {
      requestId,
    });
  }
  if (!(await vendedoresDaLoja(admin, orgId)).some((v) => v.id === vendedorId)) {
    return fail("validation_failed", t("Escolha um vendedor da loja."), 422, { requestId });
  }
  // ia.vek 0613: sem tipo escolhido, vale o único ativo ou, havendo vários, o primeiro ativo.
  const eventTypeId = input.event_type_id ?? (await tipoUnicoAtivo(admin, orgId)) ?? (await primeiroTipoAtivo(admin, orgId));
  if (!eventTypeId) {
    return fail("validation_failed", t("Escolha o tipo de agendamento."), 422, { requestId });
  }

  // v1.9.4 — a TRAVA da passagem (CRM-209): o SDR só marca para o vendedor com
  // os 7 campos do negócio e o contexto do atendimento. Os campos que vierem
  // são gravados no negócio antes da conferência (o mesmo merge da tela).
  // Pacote de segurança (31/10): o negócio é lido pela SESSÃO — o SDR só passa o
  // lead que enxerga — e o de outra pessoa da loja (nem dono, nem guardião) só a
  // gerência passa. Antes, a leitura era pela chave de serviço e o SDR tomava o
  // lead de um colega.
  const negocio = await leadDoCliente(admin, orgId, input.lead_id ?? null, input.contact_id);
  // v1.9.48 (decisão do Rodrigo, Notion 12/11 12:48Z, Maestro 125050): "livre para todos", SEM TRAVA. Agendar no lead
  // de OUTRA pessoa passa, e NÃO tira o lead do dono (antes: 403, "peça à gerência"). O lead SEM dono (ou o da própria
  // pessoa) segue a passagem de sempre. Sem lead aberto do contato, o compromisso nasce só no contato.
  const deOutraPessoa = negocio !== null && negocio.owner_user_id !== null && negocio.owner_user_id !== authz.user.id;
  // ia.vek 0613 (CRM-255/257): marcar pede só o lead, o dia e a hora. Os campos que vierem seguem
  // gravados no negócio; o que faltar NÃO trava mais o agendamento.
  const campos = negocio ? ((await anotarCampos(admin, orgId, negocio.id, passagem.campos)) ?? negocio.custom_fields) : null;

  const r = await gravarPedidoDeAgendamento(admin, {
    orgId,
    input: { ...input, event_type_id: eventTypeId },
    origem: "pessoa",
    pedidoPor: authz.user.id,
    avisarAdmins: false,
  });
  if (!r.ok) {
    const code = r.status === 404 ? "not_found" : r.status === 422 ? "validation_failed" : "internal_error";
    return fail(code, t(r.motivo), r.status, { requestId });
  }
  const pedido = r.pedido;
  // Se o compromisso não nascer, o pedido NÃO fica pendurado para o admin: o
  // SDR vê o erro na hora e marca de novo.
  const cancelarOPedido = () =>
    admin
      .from("iavek_pedidos_de_agendamento")
      .update({ status: "cancelado", updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", pedido.id);
  await admin
    .from("iavek_pedidos_de_agendamento")
    .update({ status: "confirmado", decidido_por: authz.user.id, decidido_em: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", pedido.id)
    .eq("status", "pendente");

  let compromisso: Record<string, unknown>;
  try {
    // Service role: a política da agenda só deixa o admin escrever na loja; a
    // autoridade do SDR foi conferida acima, no banco.
    compromisso = await marcarAgendamentoHandler(
      admin,
      {
        organization_id: orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
        iavekSdrMarcaParaVendedor: true,
      },
      {
        event_type_id: eventTypeId,
        starts_at: new Date(pedido.quando).toISOString(),
        contact_id: pedido.contact_id,
        ...(pedido.conversation_id ? { conversation_id: pedido.conversation_id } : {}),
        owner_user_id: vendedorId,
        ...(pedido.observacao ? { description: pedido.observacao } : {}),
        ...tituloDoCompromisso(pedido),
      },
    );
  } catch (erro) {
    await cancelarOPedido();
    if (erro instanceof ApiError) {
      return fail(erro.code, erro.message, erro.status, { requestId, details: erro.details as never });
    }
    throw erro;
  }
  const appointmentId = typeof compromisso.id === "string" ? compromisso.id : null;
  // Decisão do Rodrigo (27/10): ao marcar, o LEAD passa para o vendedor e o SDR
  // fica de GUARDIÃO — o cliente aparece no Pipeline do vendedor.
  // O lead só muda de mãos quando é da própria pessoa ou não tem dono; o de outra pessoa fica com o dono (v1.9.48).
  const mudouDeMaos = negocio !== null && !deOutraPessoa && negocio.owner_user_id !== vendedorId;
  const leadPassado = negocio === null ? null : deOutraPessoa ? negocio.id : await passarOLeadAoVendedor(admin, {
    orgId,
    // v1.9.48: o guardião é sempre um SDR. Quem marca sem ser SDR não vira guardião (fica o que já havia).
    guardiaoNovo: ehSdr ? authz.user.id : null,
    vendedorId,
    lead: negocio,
  });
  // v1.9.48 (0628, Maestro 113810): o lead SEM DONO e SEM GUARDIÃO que alguém de fora do SDR agenda ganha guardião
  // da LISTA do rodízio (a mesma do aviso do grupo, 0623). Quem agendou fica dono; lead que já tinha guardião não muda.
  if (leadPassado && negocio && !ehSdr && negocio.owner_user_id === null && negocio.sdr_user_id === null) {
    const { error: erroDoGuardiao } = await admin.rpc("fn_iavek_guardiao_do_agendamento" as never, {
      p_org: orgId,
      p_lead: leadPassado,
      p_ator: authz.user.id,
    } as never);
    if (erroDoGuardiao) logger.warn("[iavek-agenda] o guardião do rodízio não foi gravado", { lead_id: leadPassado, codigo: erroDoGuardiao.code ?? null });
  }
  // v1.9.4: o lead vai para "Agendado" e o RESUMO fica para o vendedor ler.
  const lido = leadPassado ? await lerLeadDaPassagem(admin, orgId, leadPassado) : null;
  if (lido) {
    const ctxDoSdr = { organization_id: orgId, actor: { type: "user" as const, id: authz.user.id, role: authz.org.role }, requestId };
    await moverParaAEtapaDaPassagem(admin, ctxDoSdr, lido, "agendamento");
    // o lead de outra pessoa fica com o dono: a conversa também (v1.9.48)
    if (!deOutraPessoa) await passarAConversa(admin, { orgId, contactId: lido.contact_id, para: vendedorId, actor: ctxDoSdr.actor, motivo: "Agendou e passou o lead ao vendedor" });
    // v1.9.48: só é PASSAGEM quando o lead muda de mãos; o vendedor que marca o próprio cliente não passa nada.
    if (mudouDeMaos) await registrarPassagem(admin, {
      lead: lido,
      actor: ctxDoSdr.actor,
      tipo: "agendamento",
      de: authz.user.id,
      para: vendedorId,
      detalhes: {
        campos: Object.fromEntries(
          Object.entries(campos ?? {}).filter(([k]) =>
            [...CAMPOS_DA_PASSAGEM.map((x) => x.chave as string), "troca_modelo", "troca_ano"].includes(k),
          ),
        ),
        contexto: passagem.contexto,
        quando: new Date(pedido.quando).toISOString(),
        appointment_id: appointmentId,
      },
    });
  }
  const { data: confirmado } = await admin
    .from("iavek_pedidos_de_agendamento")
    .update({ appointment_id: appointmentId, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", pedido.id)
    .select("*")
    .maybeSingle();
  void audit({
    action: "agenda.sdr_booked_for_seller",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "calendar_appointment",
    resourceId: appointmentId ?? pedido.id,
    requestId,
    metadata: { pedido_id: pedido.id, vendedor_id: vendedorId, lead_passado: mudouDeMaos ? leadPassado : null, lead_de_outra_pessoa: deOutraPessoa },
  });
  const { data: contato } = await admin
    .from("contacts")
    .select("name, display_name, phone_number")
    .eq("organization_id", orgId)
    .eq("id", pedido.contact_id)
    .maybeSingle();
  const contatoNome = contato ? rotuloDoContato(contato as never, t) : null;
  // v1.9.48: o DONO do lead (quando é outra pessoa) é avisado: "Fulano agendou ... no seu lead".
  const donoAvisado = deOutraPessoa ? (negocio?.owner_user_id ?? null) : null;
  if (donoAvisado && negocio) {
    await avisarDonoDoAgendamento(admin, {
      orgId,
      donoId: donoAvisado,
      atorId: authz.user.id,
      leadId: negocio.id,
      appointmentId,
      quando: new Date(pedido.quando).toISOString(),
      titulo: typeof compromisso.title === "string" ? compromisso.title : null,
      contatoNome,
    });
  }
  // v1.9.48: quem marcou para si mesmo não recebe aviso de si mesmo; e o dono, já avisado acima, não recebe dois.
  if (vendedorId !== authz.user.id && vendedorId !== donoAvisado) await avisarVendedorDoAgendamento(admin, {
    orgId,
    vendedorId,
    contatoNome,
    atorId: authz.user.id,
    leadId: pedido.lead_id,
    appointmentId,
    quando: new Date(pedido.quando).toISOString(),
  });
  return ok({ pedido: (confirmado ?? pedido) as PedidoGravado, compromisso }, { requestId, status: 201 });
}

interface NegocioDoCliente {
  id: string;
  custom_fields: Record<string, unknown> | null;
  owner_user_id: string | null;
  sdr_user_id: string | null;
}

/**
 * O negócio aberto do cliente (o do pedido, ou o mais recente).
 *
 * v1.9.48 (Lupa 132538): lido pelo SERVIDOR. A leitura pela sessão existia só para a guarda do 403 ("o lead de um
 * colega, só a gerência"), que saiu com o "livre para todos". Pela sessão, o SDR não enxergava o lead SEM DONO de antes
 * do corte guardiao_ve_sem_dono_desde (02/11; 520 dos 702 sem dono da Fenômenos, MEDIDO): o compromisso nascia, mas o
 * lead não passava ao vendedor, não ganhava guardião nem ia para Agendado — calado. Nada do lead volta na resposta.
 */
async function leadDoCliente(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  leadId: string | null,
  contactId: string,
): Promise<NegocioDoCliente | null> {
  let consulta = admin
    .from("crm_leads")
    .select("id, custom_fields, owner_user_id, sdr_user_id")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1);
  if (leadId) consulta = consulta.eq("id", leadId);
  const { data } = await consulta.maybeSingle();
  return (data as NegocioDoCliente | null) ?? null;
}

/**
 * Passa o lead do cliente para o vendedor, com o SDR como guardião. Primeiro
 * com a SESSÃO do SDR (o aviso "passou o lead" sai no nome dele, e o gatilho
 * 0579 grava o guardião); se a RLS não deixar (lead sem dono, da IA ou de
 * outra pessoa), pelo servidor, gravando o guardião aqui. Guardião que já
 * existia fica. Sem lead aberto do cliente: não passa nada (`null`).
 */
async function passarOLeadAoVendedor(
  admin: ReturnType<typeof createAdminClient>,
  args: { orgId: string; guardiaoNovo: string | null; vendedorId: string; lead: NegocioDoCliente },
): Promise<string | null> {
  const { lead } = args;
  if (lead.owner_user_id === args.vendedorId) return lead.id;
  const guardiao = lead.sdr_user_id ?? args.guardiaoNovo;
  const mudanca = {
    owner_user_id: args.vendedorId,
    owner_kind: "user",
    owner_agent_id: null,
    sdr_user_id: guardiao,
    assigned_at: new Date().toISOString(),
  };
  const sessao = await createClient();
  const { data: peloSdr } = await sessao
    .from("crm_leads")
    .update(mudanca)
    .eq("organization_id", args.orgId)
    .eq("id", lead.id)
    .select("id")
    .maybeSingle();
  if (peloSdr) return lead.id;
  // Pelo servidor só com o dono que a SESSÃO viu (e conferiu acima): se outra
  // pessoa assumiu o lead no meio do caminho, não passa por cima dela.
  let peloServidor = admin
    .from("crm_leads")
    .update(mudanca)
    .eq("organization_id", args.orgId)
    .eq("id", lead.id);
  peloServidor = lead.owner_user_id ? peloServidor.eq("owner_user_id", lead.owner_user_id) : peloServidor.is("owner_user_id", null);
  const { data } = await peloServidor.select("id").maybeSingle();
  return data ? lead.id : null;
}

/** Sem tipo escolhido: o único tipo ativo da empresa, se houver um só. */
/** ia.vek 0613: o primeiro tipo ativo (o mais antigo), quando há vários e ninguém escolheu. */
async function primeiroTipoAtivo(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<string | null> {
  const { data } = await admin
    .from("calendar_event_types")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function tipoUnicoAtivo(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("calendar_event_types")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(2);
  const [unico, outro] = data ?? [];
  return unico && !outro ? (unico.id as string) : null;
}
