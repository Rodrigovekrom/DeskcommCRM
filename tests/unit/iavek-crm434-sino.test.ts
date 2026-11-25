/**
 * ia.vek CRM-434 (0652): a frase do aviso "respondeu o seu cliente" no sino do dono. Sem o texto da mensagem: só quem
 * respondeu (o ator) e o cliente (o lead). O banco (quem dispara, a janela, o silêncio) é provado em
 * tests/invariants/iavek-resposta-de-outro-0652.test.ts.
 */
import { describe, expect, it } from "vitest";

import { fraseDaNotificacao, type NotificacaoDoSino } from "@/components/shell/SinoPessoal";

const base = {
  id: "n",
  lead_id: "l",
  lida: false,
  created_at: "2026-11-23T12:00:00Z",
  ator_nome: "Gerente Teste",
  contato_nome: "Cliente Teste",
} as unknown as NotificacaoDoSino;

describe("CRM-434: a frase do sino", () => {
  it("diz quem respondeu e qual cliente, nunca o texto", () => {
    const n = {
      ...base,
      tipo: "resposta_de_outro",
      dados: { conversation_id: "c-1" },
    } as NotificacaoDoSino;
    expect(fraseDaNotificacao(n, (s) => s)).toBe(
      "Gerente Teste respondeu o seu cliente Cliente Teste",
    );
  });

  it("sem o nome de quem respondeu, cai no 'Alguém'", () => {
    const n = {
      ...base,
      ator_nome: null,
      tipo: "resposta_de_outro",
      dados: {},
    } as unknown as NotificacaoDoSino;
    expect(fraseDaNotificacao(n, (s) => s)).toBe("Alguém respondeu o seu cliente Cliente Teste");
  });
});
