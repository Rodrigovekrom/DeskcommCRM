import { extensaoDe, farejarTipo, TAMANHO_MAXIMO_DA_FOTO } from "@/lib/catalogo/fotos";
import {
  feedDoAltimusSchema,
  fotosEmDia,
  mapearVeiculo,
  ORIGEM_ALTIMUS,
  PREFIXO_DO_CODIGO,
  uuidDaFoto,
  uuidDoCaminho,
  type ProdutoDoEstoque,
} from "./altimus";

/**
 * Uma rodada de sincronização do estoque do Altimus para o catálogo de UMA
 * organização (ia.vek D2 — ver `altimus.ts` para o que vai e o que não vai).
 *
 * Efeitos ficam atrás de `DepsDaSincronizacao` para o teste correr sem rede nem
 * banco; a implementação real (Supabase + fetch) está em `depsReais()`.
 *
 * Fotos têm teto por rodada (`TETO_DE_FOTOS_POR_RODADA`): a primeira carga de um
 * estoque de 60 carros são 300 fotos, e uma rodada de hora em hora termina o que
 * faltou. Foto já gravada com o mesmo nome (UUID da URL de origem) não é baixada
 * de novo.
 */
export const TETO_DE_FOTOS_POR_RODADA = 80;

export interface ProdutoGravado {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  marca: string | null;
  categoria: string | null;
  precoCents: number;
  fotos: string[];
  ativo: boolean;
}

/** O produto gravado já é igual ao do feed (sem contar fotos)? */
export function produtoEmDia(gravado: ProdutoGravado, p: ProdutoDoEstoque): boolean {
  return (
    gravado.ativo &&
    gravado.nome === p.nome &&
    (gravado.descricao ?? "") === p.descricao &&
    gravado.marca === p.marca &&
    gravado.categoria === p.categoria &&
    gravado.precoCents === p.precoCents
  );
}

export interface DepsDaSincronizacao {
  buscarFeed(): Promise<unknown>;
  baixarFoto(url: string): Promise<Uint8Array | null>;
  listarProdutosDoAltimus(): Promise<ProdutoGravado[]>;
  gravarProduto(p: ProdutoDoEstoque): Promise<string>;
  gravarFotos(produtoId: string, fotos: string[]): Promise<void>;
  subirFoto(caminho: string, bytes: Uint8Array, tipo: string): Promise<void>;
  apagarFotos(caminhos: string[]): Promise<void>;
  desativar(ids: string[]): Promise<void>;
}

export interface ResumoDaSincronizacao {
  veiculos: number;
  criados: number;
  atualizados: number;
  desativados: number;
  fotosBaixadas: number;
  fotosRecusadas: number;
  produtosComFotoPendente: number;
  /** Códigos de erro, sem dado do veículo nem a URL. */
  erros: string[];
}

export async function sincronizarEstoque(
  orgId: string,
  deps: DepsDaSincronizacao,
): Promise<ResumoDaSincronizacao> {
  const resumo: ResumoDaSincronizacao = {
    veiculos: 0,
    criados: 0,
    atualizados: 0,
    desativados: 0,
    fotosBaixadas: 0,
    fotosRecusadas: 0,
    produtosComFotoPendente: 0,
    erros: [],
  };

  let bruto: unknown;
  try {
    bruto = await deps.buscarFeed();
  } catch {
    resumo.erros.push("feed_indisponivel");
    return resumo;
  }
  const feed = feedDoAltimusSchema.safeParse(bruto);
  if (!feed.success) {
    resumo.erros.push("feed_fora_do_formato");
    return resumo;
  }
  // Feed vazio NÃO desativa o catálogo inteiro: é mais provável o Altimus ter
  // respondido errado do que a loja ter vendido todos os carros de uma vez.
  if (feed.data.veiculos.length === 0) {
    resumo.erros.push("feed_vazio");
    return resumo;
  }

  const produtos = feed.data.veiculos.map(mapearVeiculo);
  resumo.veiculos = produtos.length;
  const existentes = await deps.listarProdutosDoAltimus();
  const porCodigo = new Map(existentes.map((e) => [e.codigo, e]));

  let fotosRestantes = TETO_DE_FOTOS_POR_RODADA;
  for (const p of produtos) {
    const antes = porCodigo.get(p.codigo);
    let id: string;
    if (antes && produtoEmDia(antes, p)) {
      id = antes.id;
    } else {
      try {
        id = await deps.gravarProduto(p);
      } catch {
        resumo.erros.push("produto_nao_gravado");
        continue;
      }
      if (antes) resumo.atualizados += 1;
      else resumo.criados += 1;
    }

    const gravadas = antes?.fotos ?? [];
    if (fotosEmDia(gravadas, p.fotosDeOrigem)) continue;

    // Monta a lista nova na ordem do feed, reaproveitando o que já está no bucket.
    const porUuid = new Map(gravadas.map((c) => [uuidDoCaminho(c), c]));
    const novas: string[] = [];
    let faltou = false;
    for (const url of p.fotosDeOrigem) {
      const uuid = uuidDaFoto(url);
      const ja = porUuid.get(uuid);
      if (ja) {
        novas.push(ja);
        continue;
      }
      if (fotosRestantes <= 0) {
        faltou = true;
        continue;
      }
      fotosRestantes -= 1;
      const bytes = await deps.baixarFoto(url).catch(() => null);
      const tipo = bytes ? farejarTipo(bytes) : null;
      if (!bytes || !tipo || bytes.byteLength > TAMANHO_MAXIMO_DA_FOTO) {
        resumo.fotosRecusadas += 1;
        continue;
      }
      const caminho = `${orgId}/${id}/${uuid}.${extensaoDe(tipo)}`;
      try {
        await deps.subirFoto(caminho, bytes, tipo);
        novas.push(caminho);
        resumo.fotosBaixadas += 1;
      } catch {
        resumo.fotosRecusadas += 1;
      }
    }
    if (faltou) resumo.produtosComFotoPendente += 1;
    try {
      await deps.gravarFotos(id, novas);
      const sobraram = gravadas.filter((c) => !novas.includes(c));
      if (sobraram.length > 0) await deps.apagarFotos(sobraram).catch(() => undefined);
    } catch {
      resumo.erros.push("fotos_nao_gravadas");
    }
  }

  const noFeed = new Set(produtos.map((p) => p.codigo));
  const sairam = existentes.filter((e) => e.ativo && !noFeed.has(e.codigo)).map((e) => e.id);
  if (sairam.length > 0) {
    try {
      await deps.desativar(sairam);
      resumo.desativados = sairam.length;
    } catch {
      resumo.erros.push("desativacao_falhou");
    }
  }
  return resumo;
}

/** Algo mudou nesta rodada? (é o que decide se a rodada vai para a auditoria) */
export function rodadaTeveEfeito(r: ResumoDaSincronizacao): boolean {
  return (
    r.criados + r.atualizados + r.desativados + r.fotosBaixadas > 0 ||
    r.erros.length > 0 ||
    r.fotosRecusadas > 0
  );
}

export { ORIGEM_ALTIMUS, PREFIXO_DO_CODIGO };
