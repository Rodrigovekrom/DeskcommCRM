import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * ESTOQUE DO ALTIMUS → CATÁLOGO DE PRODUTOS (ia.vek, D2 — Fenômenos Car).
 *
 * O Altimus (hoje "Autos 360", da OLX) entrega o estoque da revenda num JSON
 * (`{ veiculos: [...] }`) cuja URL carrega a chave de acesso na query string:
 * por isso ela é SEGREDO de instalação (`ALTIMUS_ESTOQUE_URL`, cifrada em
 * `platform_config`, editada em Admin › Configuração › Integrações) e nunca
 * aparece em log.
 *
 * O que vai para o catálogo — e o que NÃO vai:
 *   - nome: marca, modelo, versão, ano, cor e câmbio. É o que a busca do agente
 *     pontua (`lib/catalogo/busca.ts` ignora a descrição), e SEM km: o prompt
 *     da revenda só fala de km quando o cliente pergunta;
 *   - descrição: ano, cor, câmbio, combustível, portas, km, potência e os
 *     opcionais. É a descrição que torna o produto PROVA de preço para a trava
 *     de promessa (`evidencias-comerciais.ts`): produto sem descrição não vale;
 *   - preço: `valorVenda`. Zero ou ausente fica 0 — sem preço, a regra de três
 *     níveis nunca autoriza um valor (vai ao consultor);
 *   - até 5 fotos, na ordem do feed (a primeira é a capa);
 *   - NUNCA placa, chassi, número do motor, código ou valor FIPE: o prompt
 *     proíbe FIPE, e placa/chassi identificam o veículo de um dono.
 *
 * Carro que saiu do feed é DESATIVADO (não apagado): o histórico das conversas
 * que o citaram continua apontando para um produto que existe.
 */

/** Prefixo do código: separa o que o sincronizador possui do catálogo manual. */
export const PREFIXO_DO_CODIGO = "ALT-";
export const ORIGEM_ALTIMUS = "altimus";
export const MAXIMO_DE_FOTOS_DO_FEED = 5;

const texto = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .optional()
  .nullable();

const veiculoSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
    marca: texto,
    modelo: texto,
    versao: texto,
    anoFabricacao: texto,
    anoModelo: texto,
    cor: texto,
    cambio: texto,
    combustivel: texto,
    portas: texto,
    km: texto,
    potencia: texto,
    tipo: texto,
    categoria: texto,
    valorVenda: texto,
    opcionais: z.array(z.unknown()).optional().nullable(),
    fotos: z.array(z.unknown()).optional().nullable(),
  })
  .passthrough();

export const feedDoAltimusSchema = z.object({ veiculos: z.array(veiculoSchema) });
export type VeiculoDoAltimus = z.infer<typeof veiculoSchema>;

export interface ProdutoDoEstoque {
  codigo: string;
  nome: string;
  marca: string | null;
  categoria: string | null;
  descricao: string;
  precoCents: number;
  /** URLs de origem das fotos, no máximo 5, na ordem do feed. */
  fotosDeOrigem: string[];
}

function limpo(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  if (t === "" || t.toLowerCase() === "none" || t.toLowerCase() === "null") return null;
  return t;
}

/** "Câmbio automático" → "Automático"; "Manual" → "Manual". */
function cambioCurto(cambio: string | null): string | null {
  if (cambio === null) return null;
  const sem = cambio.replace(/^c[aâ]mbio\s+/i, "").trim();
  return sem === "" ? null : sem.charAt(0).toUpperCase() + sem.slice(1);
}

function ano(v: VeiculoDoAltimus): string | null {
  const fab = limpo(v.anoFabricacao);
  const mod = limpo(v.anoModelo);
  if (fab && mod) return fab === mod ? fab : `${fab}/${mod}`;
  return fab ?? mod;
}

function inteiroBr(v: string | null): string | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("pt-BR") : v;
}

/**
 * A URL da foto vem de fora (o feed): só https, e nunca um endereço que aponte
 * para dentro da rede (IP literal, localhost, nomes internos). Não há lista de
 * hosts aqui de propósito — host de terceiro não fica gravado no código que vai
 * para toda instalação (`tests/unit/branding.test.ts`); o feed é configurado por
 * quem administra a instalação.
 */
export function fotoDeOrigemPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
      return false;
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[") || h.includes(":")) return false;
    return h.includes(".");
  } catch {
    return false;
  }
}

export function mapearVeiculo(v: VeiculoDoAltimus): ProdutoDoEstoque {
  const marca = limpo(v.marca);
  const anoTxt = ano(v);
  const cor = limpo(v.cor);
  const cambio = limpo(v.cambio);
  const nome = [marca, limpo(v.modelo), limpo(v.versao), anoTxt, cor, cambioCurto(cambio)]
    .filter((p): p is string => p !== null)
    .join(" ");

  const km = inteiroBr(limpo(v.km));
  const potencia = limpo(v.potencia);
  const portas = limpo(v.portas);
  const opcionais = (v.opcionais ?? [])
    .filter((o): o is string => typeof o === "string" && o.trim() !== "")
    .map((o) => o.trim());
  const partes = [
    anoTxt ? `Ano ${anoTxt}` : null,
    cor ? `Cor ${cor}` : null,
    cambio,
    limpo(v.combustivel),
    portas ? `${portas} portas` : null,
    km ? `${km} km` : null,
    potencia ? `${potencia} cv` : null,
  ].filter((p): p is string => p !== null);
  const descricao =
    partes.join(" · ") + (opcionais.length > 0 ? `. Opcionais: ${opcionais.join(", ")}.` : ".");

  const valor = Number(limpo(v.valorVenda) ?? "0");
  const precoCents = Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : 0;

  const fotosDeOrigem = (v.fotos ?? [])
    .filter((f): f is string => typeof f === "string" && fotoDeOrigemPermitida(f))
    .slice(0, MAXIMO_DE_FOTOS_DO_FEED);

  return {
    codigo: `${PREFIXO_DO_CODIGO}${v.id}`,
    nome: nome === "" ? `${PREFIXO_DO_CODIGO}${v.id}` : nome,
    marca,
    categoria: limpo(v.categoria) ?? limpo(v.tipo),
    descricao,
    precoCents,
    fotosDeOrigem,
  };
}

/**
 * Identificador ESTÁVEL de uma foto de origem, no formato de UUID que o
 * catálogo exige no nome do arquivo (`lib/catalogo/fotos.ts`). Mesma URL, mesmo
 * nome: a próxima sincronização reconhece a foto e não baixa de novo.
 */
export function uuidDaFoto(url: string): string {
  const h = createHash("sha1").update(url).digest("hex");
  const v = `5${h.slice(13, 16)}`;
  const variante = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${variante}-${h.slice(20, 32)}`;
}

/** O nome do arquivo sem a extensão (as fotos gravadas podem ser .jpg ou .png). */
export function uuidDoCaminho(caminho: string): string {
  const arquivo = caminho.slice(caminho.lastIndexOf("/") + 1);
  return arquivo.replace(/\.(jpg|png)$/, "");
}

/** As fotos gravadas já são exatamente as do feed, na mesma ordem? */
export function fotosEmDia(gravadas: readonly string[], deOrigem: readonly string[]): boolean {
  if (gravadas.length !== deOrigem.length) return false;
  return gravadas.every((c, i) => uuidDoCaminho(c) === uuidDaFoto(deOrigem[i]!));
}
