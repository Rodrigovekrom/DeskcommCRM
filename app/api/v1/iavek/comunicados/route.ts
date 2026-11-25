/**
 * ia.vek CRM-439 fase 1 (migration 0651): as orientações da loja e as novidades da versão.
 *
 *   GET  /api/v1/iavek/comunicados?para=mim     — os meus (o Meu dia e o Manual da loja), com lido e substituído_por
 *   GET  /api/v1/iavek/comunicados?enviados=1   — os da org com "X de Y leram" (só gestor)
 *   POST /api/v1/iavek/comunicados              — a gerência envia uma orientação a uma função ou a uma pessoa
 *
 * A leitura usa o cliente da SESSÃO (a RLS da 0651) com `organization_id` à mão. O envio confere o papel
 * (`requireRole("manager")`: gerente, admin e o admin da plataforma) e grava TUDO numa chamada só
 * (`fn_iavek_enviar_comunicado`, só do service_role): o comunicado, o retrato de quem recebe e o sino. Sem push.
 * O admin da plataforma que NÃO é membro da loja recebe 403 ao enviar (a função exige quem envia ativo na org): falha
 * fechada, de propósito (Lupa 121236).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  contagemDeLeitura,
  envioDaOrientacaoSchema,
  parametrosDoEnvio,
  statusDoErroDoEnvio,
  substituidoPor,
} from "@/lib/iavek/comunicados";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerTudo } from "@/lib/supabase/paginas";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, tipo, titulo, texto, alvo, para_funcao, para_usuario, pede_leitura, enviado_por, enviado_em, substitui_id, versao";

interface LinhaDoComunicado {
  id: string;
  tipo: "orientacao" | "novidade";
  titulo: string;
  texto: string;
  alvo: "funcao" | "pessoa";
  para_funcao: string | null;
  para_usuario: string | null;
  pede_leitura: boolean;
  enviado_por: string | null;
  enviado_em: string;
  substitui_id: string | null;
  versao: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const enviados = req.nextUrl.searchParams.get("enviados") === "1";
  const authz = await requireRole(enviados ? "manager" : "viewer", {
    requestId,
    resource: "iavek_comunicados",
  });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const db = await createClient();

  if (!enviados) {
    // os MEUS: pelo retrato do envio (o gestor vê todos pela RLS, mas aqui só os dele).
    const meus = await lerTudo<{ comunicado_id: string }>((de, ate) =>
      db
        .from("iavek_comunicados_destinatarios")
        .select("comunicado_id")
        .eq("organization_id", orgId)
        .eq("user_id", authz.user.id)
        .range(de, ate),
    );
    if (meus.error) return fail("internal_error", meus.error.message, 500, { requestId });
    const ids = meus.data.map((d) => d.comunicado_id);
    if (ids.length === 0) return ok({ comunicados: [] }, { requestId });
    const lista = await lerTudo<LinhaDoComunicado>((de, ate) =>
      db
        .from("iavek_comunicados")
        .select(COLUNAS)
        .eq("organization_id", orgId)
        .in("id", ids)
        .order("enviado_em", { ascending: false })
        .range(de, ate),
    );
    if (lista.error) return fail("internal_error", lista.error.message, 500, { requestId });
    const lidos = await lerTudo<{ comunicado_id: string; lida_em: string }>((de, ate) =>
      db
        .from("iavek_comunicados_lidos")
        .select("comunicado_id, lida_em")
        .eq("organization_id", orgId)
        .eq("user_id", authz.user.id)
        .range(de, ate),
    );
    if (lidos.error) return fail("internal_error", lidos.error.message, 500, { requestId });
    const lidaEm = new Map(lidos.data.map((l) => [l.comunicado_id, l.lida_em]));
    const substituidos = substituidoPor(lista.data);
    const nomes = await nomesDosAtendentes(lista.data.map((c) => c.enviado_por));
    return ok(
      {
        comunicados: lista.data.map((c) => ({
          ...c,
          enviado_por_nome: c.enviado_por ? (nomes.get(c.enviado_por) ?? null) : null,
          lido: lidaEm.has(c.id),
          lida_em: lidaEm.get(c.id) ?? null,
          substituido_por: substituidos.get(c.id) ?? null,
        })),
      },
      { requestId },
    );
  }

  // os da org, com "X de Y leram" (gestor).
  const { data, error } = await db
    .from("iavek_comunicados")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .order("enviado_em", { ascending: false })
    .limit(200);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const lista = (data ?? []) as LinhaDoComunicado[];
  const ids = lista.map((c) => c.id);
  const contagem = new Map<string, { destinatarios: number; lidos: number }>();
  if (ids.length > 0) {
    const dest = await lerTudo<{ comunicado_id: string }>((de, ate) =>
      db
        .from("iavek_comunicados_destinatarios")
        .select("comunicado_id")
        .eq("organization_id", orgId)
        .in("comunicado_id", ids)
        .range(de, ate),
    );
    if (dest.error) return fail("internal_error", dest.error.message, 500, { requestId });
    const lid = await lerTudo<{ comunicado_id: string }>((de, ate) =>
      db
        .from("iavek_comunicados_lidos")
        .select("comunicado_id")
        .eq("organization_id", orgId)
        .in("comunicado_id", ids)
        .range(de, ate),
    );
    if (lid.error) return fail("internal_error", lid.error.message, 500, { requestId });
    for (const d of dest.data) {
      const c = contagem.get(d.comunicado_id) ?? { destinatarios: 0, lidos: 0 };
      c.destinatarios += 1;
      contagem.set(d.comunicado_id, c);
    }
    for (const l of lid.data) {
      const c = contagem.get(l.comunicado_id) ?? { destinatarios: 0, lidos: 0 };
      c.lidos += 1;
      contagem.set(l.comunicado_id, c);
    }
  }
  const substituidos = substituidoPor(lista);
  const nomes = await nomesDosAtendentes([
    ...lista.map((c) => c.enviado_por),
    ...lista.map((c) => c.para_usuario),
  ]);
  return ok(
    {
      comunicados: lista.map((c) => {
        const n = contagem.get(c.id) ?? { destinatarios: 0, lidos: 0 };
        return {
          ...c,
          enviado_por_nome: c.enviado_por ? (nomes.get(c.enviado_por) ?? null) : null,
          para_usuario_nome: c.para_usuario ? (nomes.get(c.para_usuario) ?? null) : null,
          leitura: contagemDeLeitura(n.destinatarios, n.lidos),
          substituido_por: substituidos.get(c.id) ?? null,
        };
      }),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const requestId = randomUUID();
  // regra 1 (Rodrigo, 21/11): só admin e gerente enviam.
  const authz = await requireRole("manager", { requestId, resource: "iavek_comunicados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const corpo = envioDaOrientacaoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail(
      "validation_failed",
      t("Confira o título, o texto e para quem vai a orientação."),
      422,
      { requestId },
    );
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "fn_iavek_enviar_comunicado",
    parametrosDoEnvio(authz.org.orgId, {
      tipo: "orientacao",
      enviadoPor: authz.user.id,
      corpo: corpo.data,
    }),
  );
  if (error) {
    const status = statusDoErroDoEnvio(error.code);
    if (status === 422) {
      return fail(
        "validation_failed",
        t("Ninguém recebe esta orientação: confira a função ou a pessoa."),
        422,
        {
          requestId,
          details: { motivo: error.message },
        },
      );
    }
    if (status === 403)
      return fail("forbidden", t("Você não pode enviar orientações nesta empresa."), 403, {
        requestId,
      });
    return fail("internal_error", error.message, 500, { requestId });
  }
  const linha = (Array.isArray(data) ? data[0] : data) as
    { comunicado_id: string; destinatarios: number } | undefined;
  if (!linha) return fail("internal_error", t("A orientação não foi gravada."), 500, { requestId });
  void audit({
    action: "iavek.comunicado_enviado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "iavek_comunicado",
    resourceId: linha.comunicado_id,
    requestId,
    metadata: {
      tipo: "orientacao",
      alvo: corpo.data.alvo,
      para_funcao: corpo.data.alvo === "funcao" ? corpo.data.para_funcao : null,
      destinatarios: linha.destinatarios,
      substitui_id: corpo.data.substitui_id ?? null,
    },
  });
  return ok({ id: linha.comunicado_id, destinatarios: linha.destinatarios }, { requestId });
}
