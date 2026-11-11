/**
 * ia.vek v1.9.45 (CRM-280): o km de carro da LOJA até o cliente, com a partida da organização
 * (`settings.iavek.km_origem = { cep, numero }`) e a chave do servidor (ORS_API_KEY). Sem partida
 * configurada ou sem chave, o km é `null` com o motivo, e o resto (o endereço do ViaCEP) segue.
 * Um TETO DE TEMPO protege a marcação: ela nunca espera mais que `tetoMs` pelo km.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { calcularKm, enderecoDoCep, normalizaCep, textoParaGeocode, type ResultadoDoKm } from "@/lib/iavek/km/calcular-km";

export interface KmDaLoja {
  /** O endereço por extenso do CEP do cliente (ViaCEP), para o `location_details`; null se o CEP não existe. */
  endereco: string | null;
  km: number | null;
  motivo: "ok" | "sem_partida" | Exclude<ResultadoDoKm, { ok: true }>["motivo"] | "demorou";
}

export function partidaDaLoja(settings: unknown): { cep: string; numero: string | null } | null {
  const o = (settings as { iavek?: { km_origem?: { cep?: unknown; numero?: unknown } } } | null)?.iavek?.km_origem;
  const cep = typeof o?.cep === "string" ? normalizaCep(o.cep) : null;
  if (!cep) return null;
  return { cep, numero: typeof o?.numero === "string" && o.numero.trim() ? o.numero.trim() : null };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function kmDaLojaAte(
  admin: Pick<SupabaseClient, "from">,
  orgId: string,
  destino: { cep: string; numero?: string | null },
  opts: { fetcher?: Fetch; chave?: string; base?: string; tetoMs?: number } = {},
): Promise<KmDaLoja> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const cep = normalizaCep(destino.cep);
  if (!cep) return { endereco: null, km: null, motivo: "cep_invalido" };
  const end = await enderecoDoCep(cep, fetcher).catch(() => null);
  const endereco = end ? textoParaGeocode(end, destino.numero).replace(/, Brasil$/, "") : null;
  const { data: org } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const partida = partidaDaLoja((org as { settings?: unknown } | null)?.settings);
  if (!partida) return { endereco, km: null, motivo: "sem_partida" };
  const calculo = calcularKm({
    origem: partida,
    destino: { cep, numero: destino.numero ?? null },
    chave: opts.chave ?? env.ORS_API_KEY,
    base: opts.base ?? env.ORS_BASE_URL,
    fetcher,
  });
  const demorou = new Promise<"demorou">((r) => setTimeout(() => r("demorou"), opts.tetoMs ?? 6000));
  const r = await Promise.race([calculo, demorou]);
  if (r === "demorou") return { endereco, km: null, motivo: "demorou" };
  return r.ok ? { endereco, km: r.km, motivo: "ok" } : { endereco, km: null, motivo: r.motivo };
}
