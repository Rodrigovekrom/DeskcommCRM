/**
 * ia.vek v1.9.24 (CRM-195) — o CARRO DO ANÚNCIO: qual carro do estoque o anúncio de origem
 * do lead mostrava. É campo, não etiqueta (decisão do Rodrigo, 05/11), e é diferente do
 * "carro de interesse" da passagem, que pode mudar na conversa.
 *
 * Lê o texto que a plataforma mandou junto do clique (título e corpo do anúncio, já gravados
 * no contato em `source_metadata.ad_title`/`ad_body`) e procura o carro no catálogo pelo nome
 * que o Altimus monta: marca, modelo, versão, ano, cor e câmbio. Só preenche quando a
 * resposta é ÚNICA: dois carros empatados (dois Onix 2020 no pátio) ficam sem preencher,
 * porque um campo errado é pior que um campo vazio que alguém completa.
 *
 * Nunca usa placa, chassi nem valor FIPE: só o nome do catálogo e o texto do anúncio.
 */
export interface CarroDoCatalogo {
  id: string;
  nome: string;
  marca: string | null;
  ativo: boolean;
}

export type ResultadoDoAnuncio =
  | { tipo: "achou"; id: string; pontos: number }
  | { tipo: "nenhum" }
  | { tipo: "empate"; ids: string[] };

const CORES = new Set([
  "branco", "branca", "preto", "preta", "prata", "cinza", "vermelho", "vermelha", "azul", "verde",
  "bege", "marrom", "dourado", "dourada", "amarelo", "amarela", "laranja", "vinho", "grafite",
]);
const CAMBIO = new Set(["manual", "automatico", "aut", "cvt", "mt", "at", "automatizado"]);
const VAZIAS = new Set(["de", "da", "do", "e", "com", "flex", "gasolina", "alcool", "diesel", "km", "portas", "p"]);

export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const palavras = (t: string) => normalizar(t).split(" ").filter((p) => p && !VAZIAS.has(p));
const anos = (ps: string[]) => new Set(ps.filter((p) => /^(19|20)\d{2}$/.test(p)));

/** O modelo e a versão do nome do catálogo, sem marca, ano, cor e câmbio. */
function nucleoDoNome(c: CarroDoCatalogo): string[] {
  const marca = new Set(palavras(c.marca ?? ""));
  return palavras(c.nome).filter((p) => !marca.has(p) && !/^(19|20)\d{2}$/.test(p) && !CORES.has(p) && !CAMBIO.has(p));
}

/**
 * O carro do anúncio, ou nada. Precisa casar o MODELO (a 1ª palavra do núcleo) e pelo menos
 * mais uma pista (ano, outra palavra da versão ou a cor). Entre os que casam, ganha quem
 * soma mais pontos; empate no topo não preenche. O carro ativo vence o vendido com os mesmos
 * pontos (o anúncio antigo de um carro que já saiu continua valendo para o relatório).
 */
export function acharCarroDoAnuncio(texto: string | null | undefined, carros: readonly CarroDoCatalogo[]): ResultadoDoAnuncio {
  const ps = palavras(texto ?? "");
  if (ps.length === 0) return { tipo: "nenhum" };
  const tem = new Set(ps);
  const anosDoTexto = anos(ps);
  const cores = new Set(ps.filter((p) => CORES.has(p)));
  const pontuados: Array<{ id: string; pontos: number; ativo: boolean }> = [];
  for (const c of carros) {
    const nucleo = nucleoDoNome(c);
    if (nucleo.length === 0 || !tem.has(nucleo[0]!)) continue;
    let pontos = 3;
    let pistas = 0;
    for (const p of nucleo.slice(1)) if (tem.has(p)) { pontos += 1; pistas += 1; }
    const anosDoCarro = anos(palavras(c.nome));
    if (anosDoTexto.size > 0) {
      if ([...anosDoCarro].some((a) => anosDoTexto.has(a))) { pontos += 2; pistas += 1; }
      else continue; // o anúncio diz o ano e não é este
    }
    const coresDoCarro = palavras(c.nome).filter((p) => CORES.has(p));
    if (cores.size > 0 && coresDoCarro.some((p) => cores.has(p))) { pontos += 1; pistas += 1; }
    if (palavras(c.marca ?? "").some((p) => tem.has(p))) pontos += 1;
    if (pistas === 0) continue;
    pontuados.push({ id: c.id, pontos, ativo: c.ativo });
  }
  if (pontuados.length === 0) return { tipo: "nenhum" };
  const topo = Math.max(...pontuados.map((p) => p.pontos));
  let melhores = pontuados.filter((p) => p.pontos === topo);
  if (melhores.length > 1 && melhores.some((p) => p.ativo)) melhores = melhores.filter((p) => p.ativo);
  if (melhores.length > 1) return { tipo: "empate", ids: melhores.map((p) => p.id) };
  return { tipo: "achou", id: melhores[0]!.id, pontos: topo };
}

/** O texto do anúncio guardado no contato: título e corpo. */
export function textoDoAnuncio(sourceMetadata: unknown): string {
  const m = (sourceMetadata ?? {}) as Record<string, unknown>;
  return [m.ad_title, m.ad_body].filter((v): v is string => typeof v === "string" && v.trim() !== "").join(" \n ");
}
