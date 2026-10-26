import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * QUAL ORGANIZAÇÃO RECEBE O ESTOQUE DO ALTIMUS (ia.vek v1.2).
 *
 * A URL do Altimus continua sendo da INSTALAÇÃO (Admin › Configuração ›
 * Integrações): ela carrega a chave de acesso, e guardá-la em claro em
 * `organizations.settings` a deixaria legível a todo membro da organização. O
 * que passa a ser da ORGANIZAÇÃO é a marca de dona:
 * `organizations.settings.integracoes.altimus.ativa`, ligada em Configurações ›
 * Organização. Assim a instalação pode ter mais de uma organização (a da loja e
 * a de demonstração) sem a sincronização parar.
 *
 * Transição: a instalação que tem UMA organização e nunca mexeu na marca segue
 * sincronizando nela, como antes (sem isso a troca de imagem desligaria o
 * estoque da Fenômenos até alguém achar a chave). Marca explicitamente
 * desligada é respeitada.
 */

export const altimusDaOrgSchema = z.strictObject({ ativa: z.boolean() });
export type AltimusDaOrg = z.infer<typeof altimusDaOrgSchema>;

/** Lê `settings.integracoes.altimus`; ausente ou inválido = `null` (nunca mexeu). */
export function altimusDaOrg(settings: unknown): AltimusDaOrg | null {
  const integracoes = (settings as Record<string, unknown> | null)?.integracoes;
  const bruto = (integracoes as Record<string, unknown> | null | undefined)?.altimus;
  if (bruto === undefined || bruto === null) return null;
  const r = altimusDaOrgSchema.safeParse(bruto);
  return r.success ? r.data : null;
}

/** Devolve `settings` com a marca gravada, sem perder as outras integrações. */
export function settingsComAltimus(
  settings: unknown,
  altimus: AltimusDaOrg,
): Record<string, unknown> {
  const atuais = ((settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const integracoes = ((atuais.integracoes as Record<string, unknown> | null | undefined) ??
    {}) as Record<string, unknown>;
  return { ...atuais, integracoes: { ...integracoes, altimus } };
}

export type OrgDona =
  | { tipo: "marcada"; orgId: string }
  | { tipo: "unica_sem_marca"; orgId: string }
  | { tipo: "nenhuma" }
  | { tipo: "mais_de_uma"; orgIds: string[] };

/** A regra, pura: quem é a dona entre as organizações da instalação. */
export function escolherOrgDona(orgs: Array<{ id: string; settings: unknown }>): OrgDona {
  const marcadas = orgs.filter((o) => altimusDaOrg(o.settings)?.ativa === true).map((o) => o.id);
  if (marcadas.length === 1) return { tipo: "marcada", orgId: marcadas[0]! };
  if (marcadas.length > 1) return { tipo: "mais_de_uma", orgIds: marcadas };
  const unica = orgs.length === 1 ? orgs[0]! : null;
  if (unica && altimusDaOrg(unica.settings) === null)
    return { tipo: "unica_sem_marca", orgId: unica.id };
  return { tipo: "nenhuma" };
}

/** Lê as organizações da instalação e aplica a regra. Erro de leitura = nenhuma. */
export async function orgDonaDoEstoque(admin: SupabaseClient): Promise<OrgDona> {
  const { data, error } = await admin.from("organizations").select("id, settings");
  if (error || !data) return { tipo: "nenhuma" };
  return escolherOrgDona(data as Array<{ id: string; settings: unknown }>);
}

/**
 * ia.vek v1.9.0 — criar MAIS UMA organização pararia o estoque?
 *
 * Com o Altimus configurado e uma única organização que nunca marcou a chave
 * (`unica_sem_marca`), ela recebe o estoque só por ser a única. A segunda
 * organização tira essa condição e o cron passa a responder `nenhuma`: o
 * estoque da loja para em silêncio. Por isso a criação é recusada até a loja
 * ligar "Estoque Altimus" em Configurações › Organização. Pura.
 */
export function novaEmpresaPararia(altimusConfigurado: boolean, dona: OrgDona): boolean {
  return altimusConfigurado && dona.tipo === "unica_sem_marca";
}

/**
 * A pergunta acima com o banco e a configuração da instalação. Devolve o id da
 * loja que precisa ligar a chave, ou `null` quando pode criar. Erro de leitura
 * da configuração conta como "não configurado" (a criação não fica refém dela);
 * erro de leitura das organizações vira `nenhuma` em `orgDonaDoEstoque`.
 */
export async function lojaQuePrecisaLigarOAltimus(
  admin: SupabaseClient,
  urlDoAltimus: string | null | undefined,
): Promise<string | null> {
  const configurado = (urlDoAltimus ?? "").trim() !== "";
  if (!configurado) return null;
  const dona = await orgDonaDoEstoque(admin);
  return novaEmpresaPararia(configurado, dona) && dona.tipo === "unica_sem_marca" ? dona.orgId : null;
}
