/**
 * ia.vek CRM-229 (v1.9.24, completado em 06/11): a etapa que faltava — quando o lead NASCE de uma
 * conversa que veio de anúncio, procurar o carro do anúncio no catálogo e gravar `carro_anuncio`.
 * A regra (o casamento) mora em `carro-do-anuncio.ts` e só preenche quando a resposta é ÚNICA.
 * Nunca pisa num valor já gravado e nunca derruba o nascimento do lead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { acharCarroDoAnuncio, CAMPO_CARRO_DO_ANUNCIO, textoDoAnuncio, type CarroDoCatalogo } from "@/lib/iavek/carro-do-anuncio";
import { logger } from "@/lib/logger";
import { lerTudo } from "@/lib/supabase/paginas";

export type DesfechoDoCarroDoAnuncio = "gravou" | "sem_anuncio" | "nenhum" | "empate" | "ja_tinha" | "erro";

export async function gravarCarroDoAnuncio(
  db: SupabaseClient,
  orgId: string,
  leadId: string,
  sourceMetadataDoContato: unknown,
): Promise<DesfechoDoCarroDoAnuncio> {
  const texto = textoDoAnuncio(sourceMetadataDoContato);
  if (!texto) return "sem_anuncio";
  const { data: carros, error } = await lerTudo<CarroDoCatalogo>((de, ate) =>
    db.from("catalog_products").select("id, nome, marca, ativo").eq("organization_id", orgId).order("id").range(de, ate),
  );
  if (error) return "erro";
  const r = acharCarroDoAnuncio(texto, (carros ?? []) as CarroDoCatalogo[]);
  if (r.tipo !== "achou") return r.tipo;
  const { data: lead, error: e2 } = await db
    .from("crm_leads")
    .select("custom_fields")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  if (e2 || !lead) return "erro";
  const campos = ((lead as { custom_fields: Record<string, unknown> | null }).custom_fields ?? {}) as Record<string, unknown>;
  if (typeof campos[CAMPO_CARRO_DO_ANUNCIO] === "string" && (campos[CAMPO_CARRO_DO_ANUNCIO] as string).trim()) return "ja_tinha";
  const { error: e3 } = await db
    .from("crm_leads")
    .update({ custom_fields: { ...campos, [CAMPO_CARRO_DO_ANUNCIO]: r.id } })
    .eq("organization_id", orgId)
    .eq("id", leadId);
  return e3 ? "erro" : "gravou";
}

/**
 * ia.vek v1.9.37 (CRM-229): TODO desfecho do casador fica no log, não só o erro. Em 07/11, 4 leads
 * ficaram sem carro sem causa medível porque só o "erro" era registrado (e o log se perdeu no
 * reinício). Com a origem e o desfecho, "por que este lead não tem carro?" vira uma busca no log.
 * `sem_anuncio` é a maioria dos leads e não diz nada: fica fora, para o log não virar ruído.
 */
export function registrarDesfechoDoCarro(
  origem: "nascimento" | "clone_da_esteira",
  orgId: string,
  leadId: string,
  desfecho: DesfechoDoCarroDoAnuncio,
  err?: unknown,
): void {
  if (desfecho === "sem_anuncio") return;
  const ctx = {
    organization_id: orgId,
    lead_id: leadId,
    origem,
    desfecho,
    ...(err === undefined ? {} : { error: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120) }),
  };
  if (desfecho === "erro") logger.warn("carro do anúncio: não gravado", ctx);
  else logger.info("carro do anúncio: casador", ctx);
}
