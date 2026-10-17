/**
 * ia.vek v1.7: a frase de cada aviso do sino pessoal (sem dado pessoal na
 * linha do banco — nomes e títulos chegam lidos na hora pela rota).
 */
import { describe, expect, it } from "vitest";
import { fraseDaNotificacao, type NotificacaoDoSino } from "@/components/shell/SinoPessoal";

const t = (s: string) => s;
const base: NotificacaoDoSino = {
  id: "n",
  tipo: "lead_passado",
  lida: false,
  created_at: "2026-10-18T10:00:00Z",
  dados: {},
  lead_id: "l",
  lead_titulo: "Onix",
  contato_nome: "Ana",
  tarefa_titulo: null,
  ator_nome: "Carla",
  conversation_id: null,
};

describe("frases do sino pessoal", () => {
  it("lead passado, etapa, ganho, perda e tarefa vencida", () => {
    expect(fraseDaNotificacao(base, t)).toBe("Carla passou Ana para você");
    expect(
      fraseDaNotificacao({ ...base, tipo: "guardiao_etapa", dados: { para: "Agendado" } }, t),
    ).toBe("Ana foi para Agendado");
    expect(fraseDaNotificacao({ ...base, tipo: "guardiao_ganho" }, t)).toBe("Ana comprou");
    expect(
      fraseDaNotificacao({ ...base, tipo: "guardiao_perda", dados: { motivo: "Preço" } }, t),
    ).toBe("Ana não comprou · Preço");
    expect(fraseDaNotificacao({ ...base, tipo: "guardiao_perda" }, t)).toBe(
      "Ana não comprou · motivo não informado",
    );
    expect(
      fraseDaNotificacao({ ...base, tipo: "guardiao_tarefa_vencida", tarefa_titulo: "Ligar" }, t),
    ).toBe("O próximo passo de Ana venceu: Ligar");
    expect(fraseDaNotificacao({ ...base, tipo: "tarefa_vencida", tarefa_titulo: "Ligar" }, t)).toBe(
      "Sua tarefa venceu: Ligar (Ana)",
    );
  });

  it("sem contato usa o título do lead; sem ator diz 'Alguém'", () => {
    expect(fraseDaNotificacao({ ...base, contato_nome: null, ator_nome: null }, t)).toBe(
      "Alguém passou Onix para você",
    );
  });
});
