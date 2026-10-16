// ESTOQUE DO ALTIMUS → CATÁLOGO (ia.vek D2). Mapeamento (o que entra e o que NUNCA
// entra) e a rodada de sincronização com dependências falsas — sem rede nem banco.

import { describe, expect, it } from "vitest";
import {
  fotoDeOrigemPermitida,
  fotosEmDia,
  mapearVeiculo,
  uuidDaFoto,
  type VeiculoDoAltimus,
} from "@/lib/estoque/altimus";
import {
  rodadaTeveEfeito,
  sincronizarEstoque,
  type DepsDaSincronizacao,
  type ProdutoGravado,
} from "@/lib/estoque/sincronizar";

const FOTO = (n: number) => `https://s3.amazonaws.com/altimus2.arquivos.prod/x/fotos/veiculo/${n}.jpg`;

const corolla = {
  id: "4324354",
  anoFabricacao: "2017",
  anoModelo: "2018",
  km: "121303",
  portas: "4",
  valorVenda: "109900.0",
  tipo: "Carro/Camioneta",
  marca: "Toyota",
  modelo: "Corolla",
  versao: "XEI20FLEX",
  cor: "Prata",
  combustivel: "Álcool/Gasolina",
  motor: "M517089",
  placa: "ABC1D23",
  chassi: "9BRBDWHE0J0000000",
  codigoFipe: "002111-3",
  valorFipe: "99196.0",
  potencia: "154",
  cambio: "Câmbio automático",
  categoria: "None",
  opcionais: ["Direção Eletro-hidráulica", "Ar-condicionado"],
  fotos: [FOTO(1), FOTO(2), FOTO(3), FOTO(4), FOTO(5), FOTO(6), "http://inseguro.com/a.jpg"],
  observacao: "Temos um atendimento 100% humanizado",
} as unknown as VeiculoDoAltimus;

describe("mapearVeiculo", () => {
  const p = mapearVeiculo(corolla);

  it("nome com marca, modelo, versão, ano, cor e câmbio — SEM km", () => {
    expect(p.nome).toBe("Toyota Corolla XEI20FLEX 2017/2018 Prata Automático");
    expect(p.nome).not.toMatch(/km/i);
  });

  it("código com prefixo, preço em centavos, categoria cai no tipo quando vem 'None'", () => {
    expect(p.codigo).toBe("ALT-4324354");
    expect(p.precoCents).toBe(10990000);
    expect(p.categoria).toBe("Carro/Camioneta");
  });

  it("descrição completa (é a prova de preço da trava), com km e opcionais", () => {
    expect(p.descricao).toContain("121.303 km");
    expect(p.descricao).toContain("Opcionais: Direção Eletro-hidráulica, Ar-condicionado.");
  });

  it("NUNCA leva placa, chassi, motor, FIPE nem a observação", () => {
    const tudo = JSON.stringify(p);
    for (const proibido of ["ABC1D23", "9BRBDWHE0J0000000", "M517089", "002111-3", "99196", "humanizado"]) {
      expect(tudo).not.toContain(proibido);
    }
  });

  it("no máximo 5 fotos, só https e nunca endereço interno", () => {
    expect(p.fotosDeOrigem).toEqual([FOTO(1), FOTO(2), FOTO(3), FOTO(4), FOTO(5)]);
    expect(fotoDeOrigemPermitida("http://inseguro.com/a.jpg")).toBe(false);
    for (const interno of [
      "https://localhost/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://10.0.0.5/a.jpg",
      "https://[::1]/a.jpg",
      "https://supabase.internal/a.jpg",
      "https://redis/a.jpg",
    ]) {
      expect(fotoDeOrigemPermitida(interno)).toBe(false);
    }
  });

  it("sem preço vira 0 (a regra de três níveis nunca autoriza valor)", () => {
    expect(mapearVeiculo({ ...corolla, valorVenda: "0.0" } as VeiculoDoAltimus).precoCents).toBe(0);
    expect(mapearVeiculo({ ...corolla, valorVenda: null } as VeiculoDoAltimus).precoCents).toBe(0);
  });
});

describe("uuidDaFoto", () => {
  it("mesma URL, mesmo UUID, no formato que o catálogo aceita", () => {
    const u = uuidDaFoto(FOTO(1));
    expect(u).toBe(uuidDaFoto(FOTO(1)));
    expect(u).not.toBe(uuidDaFoto(FOTO(2)));
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it("fotosEmDia compara pela ordem e ignora a extensão", () => {
    const g = [`org/p/${uuidDaFoto(FOTO(1))}.jpg`, `org/p/${uuidDaFoto(FOTO(2))}.png`];
    expect(fotosEmDia(g, [FOTO(1), FOTO(2)])).toBe(true);
    expect(fotosEmDia(g, [FOTO(2), FOTO(1)])).toBe(false);
  });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function depsFalsas(feed: unknown, existentes: ProdutoGravado[] = []) {
  const log = { gravados: [] as string[], subidas: [] as string[], fotos: new Map<string, string[]>(), desativados: [] as string[], baixadas: 0 };
  const deps: DepsDaSincronizacao = {
    buscarFeed: async () => feed,
    baixarFoto: async () => {
      log.baixadas += 1;
      return JPEG;
    },
    listarProdutosDoAltimus: async () => existentes,
    gravarProduto: async (p) => {
      log.gravados.push(p.codigo);
      return existentes.find((e) => e.codigo === p.codigo)?.id ?? `id-${p.codigo}`;
    },
    gravarFotos: async (id, fotos) => void log.fotos.set(id, fotos),
    subirFoto: async (c) => void log.subidas.push(c),
    apagarFotos: async () => undefined,
    desativar: async (ids) => void log.desativados.push(...ids),
  };
  return { deps, log };
}

describe("sincronizarEstoque", () => {
  it("primeira carga: cria, sobe as 5 fotos no caminho <org>/<produto>/<uuid>.jpg", async () => {
    const { deps, log } = depsFalsas({ veiculos: [corolla] });
    const r = await sincronizarEstoque("org1", deps);
    expect(r).toMatchObject({ veiculos: 1, criados: 1, atualizados: 0, fotosBaixadas: 5, erros: [] });
    expect(log.subidas[0]).toBe(`org1/id-ALT-4324354/${uuidDaFoto(FOTO(1))}.jpg`);
    expect(rodadaTeveEfeito(r)).toBe(true);
  });

  it("segunda rodada igual: não grava, não baixa — e não audita", async () => {
    const p = mapearVeiculo(corolla);
    const gravado: ProdutoGravado = {
      id: "p1", codigo: p.codigo, nome: p.nome, descricao: p.descricao, marca: p.marca,
      categoria: p.categoria, precoCents: p.precoCents, ativo: true,
      fotos: p.fotosDeOrigem.map((u) => `org1/p1/${uuidDaFoto(u)}.jpg`),
    };
    const { deps, log } = depsFalsas({ veiculos: [corolla] }, [gravado]);
    const r = await sincronizarEstoque("org1", deps);
    expect(log.gravados).toEqual([]);
    expect(log.baixadas).toBe(0);
    expect(rodadaTeveEfeito(r)).toBe(false);
  });

  it("preço mudou: atualiza", async () => {
    const p = mapearVeiculo(corolla);
    const gravado: ProdutoGravado = {
      id: "p1", codigo: p.codigo, nome: p.nome, descricao: p.descricao, marca: p.marca,
      categoria: p.categoria, precoCents: 9999900, ativo: true,
      fotos: p.fotosDeOrigem.map((u) => `org1/p1/${uuidDaFoto(u)}.jpg`),
    };
    const { deps } = depsFalsas({ veiculos: [corolla] }, [gravado]);
    expect((await sincronizarEstoque("org1", deps)).atualizados).toBe(1);
  });

  it("carro que saiu do feed é desativado (não apagado)", async () => {
    const vendido: ProdutoGravado = {
      id: "p9", codigo: "ALT-999", nome: "x", descricao: "x", marca: null, categoria: null,
      precoCents: 1, fotos: [], ativo: true,
    };
    const { deps, log } = depsFalsas({ veiculos: [corolla] }, [vendido]);
    const r = await sincronizarEstoque("org1", deps);
    expect(r.desativados).toBe(1);
    expect(log.desativados).toEqual(["p9"]);
  });

  it("feed VAZIO não desativa o catálogo inteiro", async () => {
    const vendido: ProdutoGravado = {
      id: "p9", codigo: "ALT-999", nome: "x", descricao: "x", marca: null, categoria: null,
      precoCents: 1, fotos: [], ativo: true,
    };
    const { deps, log } = depsFalsas({ veiculos: [] }, [vendido]);
    const r = await sincronizarEstoque("org1", deps);
    expect(r.erros).toEqual(["feed_vazio"]);
    expect(log.desativados).toEqual([]);
  });

  it("feed fora do formato ou fora do ar: não mexe em nada", async () => {
    expect((await sincronizarEstoque("org1", depsFalsas({ carros: [] }).deps)).erros).toEqual(["feed_fora_do_formato"]);
    const { deps } = depsFalsas(null);
    deps.buscarFeed = async () => {
      throw new Error("timeout");
    };
    expect((await sincronizarEstoque("org1", deps)).erros).toEqual(["feed_indisponivel"]);
  });

  it("arquivo que não é JPEG/PNG é recusado", async () => {
    const { deps } = depsFalsas({ veiculos: [corolla] });
    deps.baixarFoto = async () => new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
    const r = await sincronizarEstoque("org1", deps);
    expect(r.fotosBaixadas).toBe(0);
    expect(r.fotosRecusadas).toBe(5);
  });
});
