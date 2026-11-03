import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PREFIXO_DO_CODIGO } from "@/lib/estoque/altimus";
import { MAXIMO_DE_AVISOS_SEPARADOS, sincronizarEstoque, rodadaTeveEfeito, type DepsDaSincronizacao } from "@/lib/estoque/sincronizar";
import { fraseDaNotificacao } from "@/components/shell/SinoPessoal";
import { recusaDeMotivoDaPerdaPeloBanco } from "@/lib/leads/motivo-da-perda";
import {
  PREFIXO_DO_CARRO_DO_ESTOQUE,
  carroIndisponivel,
  valorVemDoEstoque,
} from "@/lib/iavek/carro-do-lead";
import { fechadoEmDaVenda, hojeNaLoja, lerVendaDaLoja } from "@/lib/iavek/venda-da-loja";

const ID = "69278c77-0000-4000-8000-000000000001";
const produto = (extra = {}) => ({ id: ID, codigo: "ALT-1", preco_cents: 8_000_000, ativo: true, ...extra });
// 02/11/2026 às 23h30 em São Paulo já é 03/11 em UTC.
const AGORA = new Date("2026-11-03T02:30:00Z");

describe("v1.9.12 — a frase do aviso", () => {
  const base = { id: "1", tipo: "aviso_da_loja", lida: false, created_at: "", lead_id: null, lead_titulo: null, contato_nome: null, tarefa_titulo: null, ator_nome: null, conversation_id: null };
  it("um carro diz qual; o resumo só diz quantos", () => {
    expect(fraseDaNotificacao({ ...base, dados: { evento: "carro_saiu", carro_nome: "Onix" } }, (s) => s)).toBe("Onix saiu do estoque");
    expect(fraseDaNotificacao({ ...base, dados: { evento: "carros_sairam", quantidade: 6 } }, (s) => s)).toBe("6 carros saíram do estoque");
  });
  it("o limite do resumo é 5", () => {
    expect(MAXIMO_DE_AVISOS_SEPARADOS).toBe(5);
  });
});

describe("v1.9.12 — a recusa do banco vira recusa de negócio", () => {
  it("venda_incompleta é 422 legível, e não 500", () => {
    expect(recusaDeMotivoDaPerdaPeloBanco({ code: "PT422", message: "venda_incompleta: informe" }, "pt-BR")).toMatchObject({ codigo: "venda_incompleta" });
  });
});

describe("v1.9.12 — a venda da loja de carros", () => {
  it("a data de hoje é a da loja, não a de UTC", () => {
    expect(hojeNaLoja(AGORA)).toBe("2026-11-02");
  });

  it("valor final e data são obrigatórios", () => {
    for (const bruto of [undefined, {}, { valor_cents: 100 }, { data: "2026-11-02" }, { valor_cents: 0, data: "2026-11-02" }, { valor_cents: 1.5, data: "2026-11-02" }]) {
      expect(lerVendaDaLoja(bruto, "pt-BR", AGORA)).toMatchObject({ ok: false, codigo: "venda_incompleta" });
    }
  });

  it("data no futuro ou que não existe é recusada", () => {
    for (const data of ["2026-11-03", "2026-02-31"]) {
      expect(lerVendaDaLoja({ valor_cents: 100, data }, "pt-BR", AGORA)).toMatchObject({ ok: false, codigo: "venda_data_invalida" });
    }
  });

  it("hoje grava o agora; dia passado grava meio-dia da loja, no mesmo dia", () => {
    expect(fechadoEmDaVenda("2026-11-02", AGORA)).toBe(AGORA.toISOString());
    const passado = fechadoEmDaVenda("2026-10-20", AGORA);
    expect(hojeNaLoja(new Date(passado))).toBe("2026-10-20");
    expect(lerVendaDaLoja({ valor_cents: 7_500_000, data: "2026-10-20" }, "pt-BR", AGORA)).toEqual({
      ok: true,
      valorCents: 7_500_000,
      data: "2026-10-20",
      fechadoEm: passado,
    });
  });
});

describe("v1.9.12 — o carro do lead", () => {
  it("o selo só aparece em lead ABERTO com carro fora do estoque", () => {
    const fora = [produto({ ativo: false })];
    expect(carroIndisponivel(ID, "open", fora)).toBe(true);
    expect(carroIndisponivel(ID, "won", fora)).toBe(false);
    expect(carroIndisponivel(ID, "lost", fora)).toBe(false);
    expect(carroIndisponivel(ID, "open", [produto()])).toBe(false);
    expect(carroIndisponivel("Onix prata", "open", fora)).toBe(false);
    expect(carroIndisponivel(ID, "open", undefined)).toBe(false);
  });

  it("o valor vem do estoque só em lead aberto, carro do Altimus e com preço", () => {
    expect(valorVemDoEstoque(ID, "open", [produto()])).toBe(true);
    expect(valorVemDoEstoque(ID, "won", [produto()])).toBe(false);
    expect(valorVemDoEstoque(ID, "open", [produto({ preco_cents: 0 })])).toBe(false);
    expect(valorVemDoEstoque(ID, "open", [produto({ codigo: "MANUAL-1" })])).toBe(false);
  });

  it("o prefixo da tela é o mesmo do estoque", () => {
    expect(PREFIXO_DO_CARRO_DO_ESTOQUE).toBe(PREFIXO_DO_CODIGO);
  });
});

describe("v1.9.12 — o aviso de carro que saiu", () => {
  const veiculo = { codigo: "1" };
  const deps = (over: Partial<DepsDaSincronizacao>): DepsDaSincronizacao => ({
    buscarFeed: async () => ({ veiculos: [veiculo] }),
    baixarFoto: async () => null,
    listarProdutosDoAltimus: async () => [],
    gravarProduto: async () => ID,
    gravarFotos: async () => undefined,
    subirFoto: async () => undefined,
    apagarFotos: async () => undefined,
    desativar: async () => undefined,
    ...over,
  });

  it("feed vazio ou fora do ar nunca avisa ninguém", async () => {
    let chamadas = 0;
    const avisarCarrosQueSairam = async () => ++chamadas;
    await sincronizarEstoque("org", deps({ buscarFeed: async () => ({ veiculos: [] }), avisarCarrosQueSairam }));
    await sincronizarEstoque("org", deps({ buscarFeed: async () => { throw new Error("x"); }, avisarCarrosQueSairam }));
    expect(chamadas).toBe(0);
  });

  it("rodada que avisou conta como efeito (vai para a auditoria)", () => {
    const base = { veiculos: 1, criados: 0, atualizados: 0, desativados: 0, carrosAvisados: 0, fotosBaixadas: 0, fotosRecusadas: 0, produtosComFotoPendente: 0, erros: [] };
    expect(rodadaTeveEfeito(base)).toBe(false);
    expect(rodadaTeveEfeito({ ...base, carrosAvisados: 2 })).toBe(true);
  });

  it("o aviso leva só o carro: nenhum dado de lead ou de cliente", () => {
    const mig = readFileSync("supabase/migrations/20261103010000_0600_iavek_estoque_manda_no_lead.sql", "utf8");
    const i = mig.indexOf("create or replace function public.fn_iavek_aviso_da_loja");
    const corpo = mig.slice(i, mig.indexOf("$$;", i));
    expect(corpo).toContain("'evento', p_evento, 'carro_id', p_carro, 'carro_nome', v_nome");
    expect(corpo).not.toMatch(/lead_id|crm_leads|contacts|placa|chassi|fipe/i);
  });
});
