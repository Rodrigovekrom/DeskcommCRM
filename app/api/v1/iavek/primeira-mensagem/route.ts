/**
 * GET /api/v1/iavek/primeira-mensagem?conversation_id= — ia.vek v1.9.6.
 *
 * O modelo da PRIMEIRA mensagem de quem é responsável pelo lead (guardião ou
 * vendedor), já preenchido, para a caixa de texto. Só leitura e só sugestão:
 * nada é enviado daqui. Devolve `texto: null` quando não se aplica — sem
 * modelo gravado, sem função com modelo, a pessoa não é a responsável pelo
 * lead aberto, ou já falou neste lead.
 *
 * Service role (a conversa, o lead e o compromisso atravessam tabelas), sempre
 * filtrando a organização à mão; a pessoa é `authz.user.id`, nunca parâmetro.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { funcaoDaTela } from "@/lib/iavek/funcoes";
import {
  diaDoCompromisso,
  horaDoCompromisso,
  modeloDaFuncao,
  preencherModelo,
  primeiroNome,
} from "@/lib/iavek/primeira-mensagem";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const nada = (requestId: string) => ok({ texto: null }, { requestId });

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const conversa = z.string().uuid().safeParse(req.nextUrl.searchParams.get("conversation_id"));
  if (!conversa.success) return fail("validation_failed", "conversation_id inválido.", 422, { requestId });

  const orgId = authz.org.orgId;
  const eu = authz.user.id;
  const funcao = funcaoDaTela(authz.org.interface_settings?.funcao);
  const db = createAdminClient();

  try {
    const { data: org, error: eOrg } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    if (eOrg) throw new Error(eOrg.message);
    const modelo = modeloDaFuncao(org?.settings, funcao);
    if (!modelo) return nada(requestId);

    const { data: conv, error: eConv } = await db
      .from("conversations")
      .select("id, contact_id, is_group")
      .eq("organization_id", orgId)
      .eq("id", conversa.data)
      .maybeSingle();
    if (eConv) throw new Error(eConv.message);
    if (!conv?.contact_id || conv.is_group) return nada(requestId);

    // O lead aberto deste contato em que a pessoa é a responsável (o guardião
    // também conta pelo vínculo de guardião, que fica mesmo depois da passagem).
    const meu = funcao === "sdr" ? `owner_user_id.eq.${eu},sdr_user_id.eq.${eu}` : `owner_user_id.eq.${eu}`;
    const { data: lead, error: eLead } = await db
      .from("crm_leads")
      .select("id, created_at")
      .eq("organization_id", orgId)
      .eq("contact_id", conv.contact_id)
      .eq("status", "open")
      .or(meu)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eLead) throw new Error(eLead.message);
    if (!lead) return nada(requestId);

    // Já falou neste lead (desde que ele nasceu)? Então não é a primeira.
    const { count, error: eMsg } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("conversation_id", conv.id)
      .eq("direction", "outbound")
      .eq("sent_by_user_id", eu)
      .gte("created_at", lead.created_at);
    if (eMsg) throw new Error(eMsg.message);
    if ((count ?? 0) > 0) return nada(requestId);

    const [{ data: contato }, { data: compromisso }] = await Promise.all([
      db.from("contacts").select("display_name, name").eq("organization_id", orgId).eq("id", conv.contact_id).maybeSingle(),
      db
        .from("calendar_appointments")
        .select("starts_at, time_zone")
        .eq("organization_id", orgId)
        .eq("contact_id", conv.contact_id)
        .not("status", "in", "(cancelled,no_show)")
        .gte("starts_at", new Date(Date.now() - 2 * 3_600_000).toISOString())
        .order("starts_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    const fuso = compromisso?.time_zone || authz.org.timezone || "America/Sao_Paulo";
    const inicio = compromisso?.starts_at ? new Date(compromisso.starts_at) : null;
    const texto = preencherModelo(modelo, {
      primeiro_nome: primeiroNome(nomeDoContato(contato)),
      dia: inicio ? diaDoCompromisso(inicio, new Date(), fuso) : null,
      hora: inicio ? horaDoCompromisso(inicio, fuso) : null,
    });
    return ok({ texto }, { requestId });
  } catch (erro) {
    return fail("internal_error", erro instanceof Error ? erro.message : String(erro), 500, { requestId });
  }
}
