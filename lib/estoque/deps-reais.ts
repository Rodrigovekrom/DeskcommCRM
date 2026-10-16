import { BUCKET_DAS_FOTOS } from "@/lib/catalogo/fotos";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORIGEM_ALTIMUS, PREFIXO_DO_CODIGO, type ProdutoDoEstoque } from "./altimus";
import type { DepsDaSincronizacao, ProdutoGravado } from "./sincronizar";

/**
 * As dependências REAIS da sincronização do estoque (ia.vek D2): o feed por
 * HTTP, o catálogo pelo client admin (service role — por isso TODA consulta
 * filtra `organization_id` aqui, à mão) e as fotos no bucket privado do catálogo.
 *
 * A URL do feed carrega a chave de acesso: ela nunca entra em erro, log ou
 * auditoria — as mensagens de falha abaixo são genéricas de propósito.
 */
const TETO_DO_FEED_BYTES = 10 * 1024 * 1024;

export function depsReais(orgId: string, urlDoFeed: string): DepsDaSincronizacao {
  const admin = createAdminClient();

  return {
    async buscarFeed() {
      const resposta = await fetch(urlDoFeed, {
        signal: AbortSignal.timeout(30_000),
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!resposta.ok) throw new Error(`feed respondeu ${resposta.status}`);
      const corpo = await resposta.text();
      if (corpo.length > TETO_DO_FEED_BYTES) throw new Error("feed grande demais");
      return JSON.parse(corpo) as unknown;
    },

    async baixarFoto(url) {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (!resposta.ok) return null;
      const declarado = Number(resposta.headers.get("content-length") ?? "0");
      if (declarado > 6 * 1024 * 1024) return null;
      return new Uint8Array(await resposta.arrayBuffer());
    },

    async listarProdutosDoAltimus() {
      const { data, error } = await admin
        .from("catalog_products")
        .select("id, codigo, nome, descricao, marca, categoria, preco_cents, fotos, ativo")
        .eq("organization_id", orgId)
        .like("codigo", `${PREFIXO_DO_CODIGO}%`);
      if (error) throw new Error("catálogo não lido");
      return (data ?? []).map(
        (r): ProdutoGravado => ({
          id: r.id as string,
          codigo: r.codigo as string,
          nome: r.nome as string,
          descricao: (r.descricao as string | null) ?? null,
          marca: (r.marca as string | null) ?? null,
          categoria: (r.categoria as string | null) ?? null,
          precoCents: Number(r.preco_cents),
          fotos: ((r.fotos as string[] | null) ?? []).filter((c) => c.startsWith(`${orgId}/`)),
          ativo: r.ativo as boolean,
        }),
      );
    },

    async gravarProduto(p: ProdutoDoEstoque) {
      const { data, error } = await admin
        .from("catalog_products")
        .upsert(
          {
            organization_id: orgId,
            codigo: p.codigo,
            nome: p.nome,
            descricao: p.descricao,
            marca: p.marca,
            categoria: p.categoria,
            preco_cents: p.precoCents,
            moeda: "BRL",
            controla_estoque: true,
            quantidade: 1,
            ativo: true,
            origem: ORIGEM_ALTIMUS,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,codigo" },
        )
        .select("id")
        .single();
      if (error || !data) throw new Error("produto não gravado");
      return data.id as string;
    },

    async gravarFotos(produtoId, fotos) {
      const { error } = await admin
        .from("catalog_products")
        .update({ fotos, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("id", produtoId);
      if (error) throw new Error("fotos não gravadas");
    },

    async subirFoto(caminho, bytes, tipo) {
      const { error } = await admin.storage
        .from(BUCKET_DAS_FOTOS)
        .upload(caminho, bytes, { contentType: tipo, upsert: true });
      if (error) throw new Error("foto não subiu");
    },

    async apagarFotos(caminhos) {
      const daOrg = caminhos.filter((c) => c.startsWith(`${orgId}/`));
      if (daOrg.length > 0) await admin.storage.from(BUCKET_DAS_FOTOS).remove(daOrg);
    },

    async desativar(ids) {
      const { error } = await admin
        .from("catalog_products")
        .update({ ativo: false, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("origem", ORIGEM_ALTIMUS)
        .in("id", ids);
      if (error) throw new Error("desativação falhou");
    },
  };
}

/**
 * A organização dona do estoque. Esta instalação tem UMA organização (a
 * Fenômenos); com mais de uma, a sincronização se recusa em vez de escolher.
 */
export async function organizacaoUnica(): Promise<string | null> {
  const { data, error } = await createAdminClient().from("organizations").select("id").limit(2);
  if (error || !data || data.length !== 1) return null;
  return data[0]!.id as string;
}
