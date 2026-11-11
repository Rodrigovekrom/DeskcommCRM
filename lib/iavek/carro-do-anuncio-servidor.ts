/**
 * ia.vek CRM-229 (v1.9.24, completado em 06/11): a etapa que faltava — quando o lead NASCE de uma
 * conversa que veio de anúncio, procurar o carro do anúncio no catálogo e gravar `carro_anuncio`.
 * A regra (o casamento) mora em `carro-do-anuncio.ts` e só preenche quando a resposta é ÚNICA.
 * Nunca pisa num valor já gravado e nunca derruba o nascimento do lead.
 */
import { mesclarSourceMetadata } from "@/lib/leads/mesclar-source-metadata";
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
  if (r.tipo !== "achou") {
    await marcarDesfechoNoLead(db, orgId, leadId, r.tipo, r.tipo === "empate" ? r.ids : []);
    return r.tipo;
  }
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

/** O campo do lead onde o desfecho sem carro fica guardado (source_metadata). */
export const CAMPO_DESFECHO_DO_CARRO = "iavek_carro_desfecho";

/**
 * ia.vek P3 (11/11): o desfecho SEM carro ("nenhum" ou "empate") fica gravado NO LEAD, em
 * `source_metadata.iavek_carro_desfecho = {desfecho, em, candidatos}`. Os 2 leads "sem causa medida"
 * de 07/11 eram um EMPATE (dois Polo Track 2023/2024 cinza ativos), e a causa se perdeu porque o
 * log do contêiner some a cada troca. No lead, "por que este lead não tem carro?" tem resposta.
 * Nunca derruba o nascimento: falhar aqui só deixa um aviso no log.
 */
async function marcarDesfechoNoLead(
  db: SupabaseClient,
  orgId: string,
  leadId: string,
  desfecho: "nenhum" | "empate",
  candidatos: readonly string[],
): Promise<void> {
  try {
    // v1.9.43 (0616): mesclado NO BANCO (`||`), sem ler-e-regravar o source_metadata inteiro.
    const marca = { desfecho, em: new Date().toISOString(), ...(candidatos.length ? { candidatos: candidatos.slice(0, 5) } : {}) };
    const r = await mesclarSourceMetadata(db, orgId, leadId, { [CAMPO_DESFECHO_DO_CARRO]: marca });
    if (!r.ok) logger.warn("carro do anúncio: desfecho não marcado no lead", { organization_id: orgId, lead_id: leadId, error: r.erro.slice(0, 120) });
  } catch (err) {
    logger.warn("carro do anúncio: desfecho não marcado no lead", {
      organization_id: orgId,
      lead_id: leadId,
      error: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
    });
  }
}

