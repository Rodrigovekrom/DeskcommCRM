/**
 * ia.vek v1.9.45 (CRM-280, Rodrigo 11/11, opção 1 grátis): o km de carro da loja até o cliente, para o
 * agendamento "Ir até o cliente". Caminho: CEP → endereço (ViaCEP, sem chave) → coordenada (geocode
 * Pelias do HeiGIT) → rota de carro (OpenRouteService do HeiGIT). Tudo do SERVIDOR.
 *
 * Sem a chave (ORS_API_KEY ausente) o resultado é `indisponivel` e nada quebra: o agendamento segue sem
 * o km. O `fetch` é injetado (testes com dublê); o endereço da API é configurável (o antigo
 * api.openrouteservice.org foi trocado por api.heigit.org em 2026).
 * Atribuição exigida pelos termos, onde o km aparece: ATRIBUICAO_DO_KM.
 */
export const ATRIBUICAO_DO_KM = "© openrouteservice.org by HeiGIT | dados © OpenStreetMap";
export const ORS_BASE_PADRAO = "https://api.heigit.org";

export interface EnderecoDoCep {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export type ResultadoDoKm =
  | { ok: true; km: number; origem: [number, number]; destino: [number, number] }
  | { ok: false; motivo: "indisponivel" | "cep_invalido" | "cep_nao_encontrado" | "endereco_nao_encontrado" | "rota_nao_encontrada" | "erro_do_servico" };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function normalizaCep(cep: string): string | null {
  const d = (cep ?? "").replace(/\D/g, "");
  return d.length === 8 ? d : null;
}

export async function enderecoDoCep(cep: string, fetcher: Fetch): Promise<EnderecoDoCep | null> {
  const c = normalizaCep(cep);
  if (!c) return null;
  const r = await fetcher(`https://viacep.com.br/ws/${c}/json/`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = (await r.json()) as Record<string, string | boolean>;
  if (j.erro) return null;
  return {
    cep: c,
    logradouro: String(j.logradouro ?? ""),
    bairro: String(j.bairro ?? ""),
    cidade: String(j.localidade ?? ""),
    uf: String(j.uf ?? ""),
  };
}

/** O texto que vai ao geocode: rua e número, bairro, cidade, UF, Brasil. */
export function textoParaGeocode(e: EnderecoDoCep, numero?: string | null): string {
  const rua = [e.logradouro, numero?.trim()].filter(Boolean).join(", ");
  return [rua, e.bairro, `${e.cidade} - ${e.uf}`, "Brasil"].filter((p) => p && p.trim()).join(", ");
}

async function geocode(texto: string, chave: string, base: string, fetcher: Fetch): Promise<[number, number] | null> {
  const u = new URL(`${base.replace(/\/$/, "")}/pelias/v1/search`);
  u.searchParams.set("text", texto);
  u.searchParams.set("boundary.country", "BR");
  u.searchParams.set("size", "1");
  const r = await fetcher(u.toString(), { headers: { Authorization: chave }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`geocode ${r.status}`);
  const j = (await r.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> };
  const c = j.features?.[0]?.geometry?.coordinates;
  return c && c.length === 2 ? [c[0], c[1]] : null;
}

async function kmDeCarro(de: [number, number], para: [number, number], chave: string, base: string, fetcher: Fetch): Promise<number | null> {
  const r = await fetcher(`${base.replace(/\/$/, "")}/ors/v2/directions/driving-car`, {
    method: "POST",
    headers: { Authorization: chave, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [de, para] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`directions ${r.status}`);
  const j = (await r.json()) as { routes?: Array<{ summary?: { distance?: number } }> };
  const m = j.routes?.[0]?.summary?.distance;
  return typeof m === "number" ? Math.round(m / 100) / 10 : null; // metros → km, 1 casa decimal
}

export async function calcularKm(params: {
  origem: { cep: string; numero?: string | null };
  destino: { cep: string; numero?: string | null };
  chave?: string | null;
  base?: string | null;
  fetcher?: Fetch;
}): Promise<ResultadoDoKm> {
  const chave = params.chave?.trim();
  if (!chave) return { ok: false, motivo: "indisponivel" };
  const fetcher = params.fetcher ?? ((u, i) => fetch(u, i));
  const base = params.base?.trim() || ORS_BASE_PADRAO;
  if (!normalizaCep(params.origem.cep) || !normalizaCep(params.destino.cep)) return { ok: false, motivo: "cep_invalido" };
  try {
    const [eo, ed] = await Promise.all([enderecoDoCep(params.origem.cep, fetcher), enderecoDoCep(params.destino.cep, fetcher)]);
    if (!eo || !ed) return { ok: false, motivo: "cep_nao_encontrado" };
    const [co, cd] = await Promise.all([
      geocode(textoParaGeocode(eo, params.origem.numero), chave, base, fetcher),
      geocode(textoParaGeocode(ed, params.destino.numero), chave, base, fetcher),
    ]);
    if (!co || !cd) return { ok: false, motivo: "endereco_nao_encontrado" };
    const km = await kmDeCarro(co, cd, chave, base, fetcher);
    if (km === null) return { ok: false, motivo: "rota_nao_encontrada" };
    return { ok: true, km, origem: co, destino: cd };
  } catch {
    return { ok: false, motivo: "erro_do_servico" };
  }
}
