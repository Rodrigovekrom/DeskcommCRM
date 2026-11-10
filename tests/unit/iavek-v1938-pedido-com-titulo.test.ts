import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pedidoDeAgendamentoSchema, tituloDoCompromisso } from "@/lib/iavek/pedidos-de-agendamento";

/**
 * ia.vek v1.9.38 (CRM-256) — o título próprio pelo CARTÃO DO LEAD.
 *
 * Na Fenômenos o SDR marca pelo "Marcar/Pedir agendamento" (`PedirAgendamento`), que grava um PEDIDO;
 * o compromisso nasce quando o admin confirma, ou na hora, para o SDR que marca direto. A 0615 dá ao
 * pedido a coluna `titulo`, e os dois caminhos levam ESSE título para o compromisso.
 *
 * As três condições do Maestro (10/11):
 *   (1) pedido COM título, confirmado → compromisso com ESSE título;
 *   (2) pedido SEM título → compromisso com o nome do tipo (o handler faz `input.title ?? tipo.name`);
 *   (3) pedido ANTIGO (coluna nula, ou nem lida) → igual ao (2), sem erro.
 */
const CONTATO = "11111111-1111-4111-8111-111111111111";
const QUANDO = "2026-11-20T14:00:00-03:00";

describe("o título do pedido vira o título do compromisso", () => {
  it("(1) com título próprio, o compromisso leva ESSE título", () => {
    expect(tituloDoCompromisso({ titulo: "Test drive do Corolla" })).toEqual({ title: "Test drive do Corolla" });
    expect(tituloDoCompromisso({ titulo: "  Avaliação da troca  " })).toEqual({ title: "Avaliação da troca" });
  });

  it("(2) sem título, nada vai — o handler usa o nome do tipo", () => {
    expect(tituloDoCompromisso({ titulo: null })).toEqual({});
    expect(tituloDoCompromisso({ titulo: "   " })).toEqual({});
    const handler = readFileSync("app/api/v1/agenda/agendamentos/_handler.ts", "utf8");
    expect(handler).toContain("title: input.title ?? tipo.name,");
  });

  it("(3) o pedido antigo, sem a coluna, segue igual ao (2)", () => {
    // Pedido gravado antes da 0615: `select("*")` devolve titulo = null; numa leitura sem a coluna, o
    // campo nem existe. Os dois dão o mesmo compromisso de antes.
    expect(tituloDoCompromisso({})).toEqual({});
    expect(tituloDoCompromisso({ titulo: undefined })).toEqual({});
  });

  it("os dois caminhos que criam o compromisso usam a função (marcar direto e confirmar)", () => {
    const marcarDireto = readFileSync("app/api/v1/iavek/pedidos-de-agendamento/route.ts", "utf8");
    const confirmar = readFileSync("app/api/v1/iavek/pedidos-de-agendamento/[id]/route.ts", "utf8");
    for (const rota of [marcarDireto, confirmar]) {
      const chamada = rota.slice(rota.indexOf("await marcarAgendamentoHandler("));
      expect(chamada.slice(0, chamada.indexOf("});") + 3)).toContain("...tituloDoCompromisso(pedido),");
    }
  });
});

describe("o pedido aceita o título, e o de antes continua válido", () => {
  it("o corpo com título passa; sem título também; vazio e acima de 200 não", () => {
    expect(pedidoDeAgendamentoSchema.safeParse({ contact_id: CONTATO, quando: QUANDO, titulo: "Visita com a esposa" }).success).toBe(true);
    expect(pedidoDeAgendamentoSchema.safeParse({ contact_id: CONTATO, quando: QUANDO }).success).toBe(true);
    expect(pedidoDeAgendamentoSchema.safeParse({ contact_id: CONTATO, quando: QUANDO, titulo: "" }).success).toBe(false);
    expect(pedidoDeAgendamentoSchema.safeParse({ contact_id: CONTATO, quando: QUANDO, titulo: "x".repeat(201) }).success).toBe(false);
  });

  it("o gravador grava o título (ou nulo) e a lista do admin o lê e mostra", () => {
    const lib = readFileSync("lib/iavek/pedidos-de-agendamento.ts", "utf8");
    expect(lib).toContain("titulo: input.titulo?.length ? input.titulo : null,");
    const rota = readFileSync("app/api/v1/iavek/pedidos-de-agendamento/route.ts", "utf8");
    expect(rota).toContain("observacao, titulo, origem,");
    const lista = readFileSync("components/iavek/PedidosDeAgendamento.tsx", "utf8");
    expect(lista).toContain('data-testid="pedido-titulo-na-lista"');
  });

  it("a janela do cartão do lead tem o Título, segue o tipo e manda só se tiver texto", () => {
    const janela = readFileSync("components/iavek/PedirAgendamento.tsx", "utf8");
    expect(janela).toContain('data-testid="pedido-titulo"');
    expect(janela).toContain('const titulo = tituloEditado ?? tipos.find((x) => x.id === tipoId)?.name ?? "";');
    expect(janela).toContain("...(titulo.trim() ? { titulo: titulo.trim() } : {}),");
  });
});

describe("a 0615 é aditiva, anulável e tem volta", () => {
  // Só o SQL que roda: os comentários citam a volta (drop column) de propósito.
  const mig = readFileSync("supabase/migrations/20261110120000_0615_iavek_titulo_do_pedido_de_agendamento.sql", "utf8")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n");
  const baseline = readFileSync("supabase/baseline.sql", "utf8");

  it("só acrescenta uma coluna anulável, com o mesmo teto da API, idempotente", () => {
    expect(mig).toContain("add column if not exists titulo text;");
    expect(mig).not.toMatch(/titulo text not null/);
    expect(mig).toContain("length(titulo) between 1 and 200");
    expect(mig).not.toMatch(/\b(update|delete)\s+(from\s+)?public\./i);
    expect(mig).not.toMatch(/drop\s+(table|column)/i);
  });

  it("o baseline traz o mesmo bloco (instalação nova nasce com a coluna)", () => {
    expect(baseline).toContain("-- ---- ia.vek: título próprio do pedido de agendamento (migration 0615) ----");
    const bloco = baseline.slice(baseline.indexOf("(migration 0615) ----"));
    expect(bloco).toContain("add column if not exists titulo text;");
  });
});
