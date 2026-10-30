import { describe, expect, it } from "vitest";

import { DESTINOS_DA_FUNCAO, ROTULO_DA_FUNCAO } from "@/lib/iavek/funcoes";
import {
  diaDoCompromisso,
  horaDoCompromisso,
  modeloDaFuncao,
  preencherModelo,
  primeiroNome,
} from "@/lib/iavek/primeira-mensagem";
import { aplicarAssinatura, configAssinatura, linhaDeAssinatura, semAssinatura } from "@/lib/messaging/assinatura";
import { sidebarGroups } from "@/lib/navigation/registry";

/** A configuração da Fenômenos (v1.9.6, Rodrigo 30/10). */
const FENOMENOS = {
  assinatura_mensagens: {
    humanos: true,
    ia: true,
    nome_ia: "Juliana | Primeiro Atendimento",
    cabecalhos: {
      ia: { titulo: "Daiane 🚗💛", frase: "Entende o que você busca e apresenta a melhor solução:" },
      funcoes: {
        sdr: { emoji: "🚗⏳", frase: "Estou aqui para firmar seu compromisso com a gente" },
        vendedor: { emoji: "🚗🎁", frase: "Faço um negocio junto e com as melhores condições da região" },
      },
    },
  },
};

describe("v1.9.6 — assinatura: cabeçalho fixo por papel", () => {
  const c = configAssinatura(FENOMENOS);

  it("IA, guardião e vendedor: *Nome emoji*, a frase em citação e uma linha em branco", () => {
    expect(aplicarAssinatura(linhaDeAssinatura(c, "ai"), "Maravilha Rodrigo")).toBe(
      "*Daiane 🚗💛*\n> Entende o que você busca e apresenta a melhor solução:\n\nMaravilha Rodrigo",
    );
    expect(linhaDeAssinatura(c, "user", "paloma souza", "sdr")).toBe(
      "*Paloma 🚗⏳*\n> Estou aqui para firmar seu compromisso com a gente\n\n",
    );
    expect(linhaDeAssinatura(c, "user", "iago", "vendedor")).toBe(
      "*Iago 🚗🎁*\n> Faço um negocio junto e com as melhores condições da região\n\n",
    );
  });

  it("sem cabeçalho (gerente, Suporte IA, sem função): fica como era", () => {
    expect(linhaDeAssinatura(c, "user", "lucas lima", "gerente")).toBe("*Lucas Lima | Gerente de Negócios*\n");
    expect(linhaDeAssinatura(c, "user", "ana", "suporte")).toBe("*Ana | Atendimento*\n");
    expect(linhaDeAssinatura(c, "user", "rodrigo", null)).toBe("*Rodrigo*\n");
  });

  it("organização sem cabeçalhos: nada muda", () => {
    const antiga = configAssinatura({ assinatura_mensagens: { humanos: true, ia: true, nome_ia: "Juliana" } });
    expect(linhaDeAssinatura(antiga, "ai")).toBe("*Juliana*\n");
    expect(linhaDeAssinatura(antiga, "user", "ana", "sdr")).toBe("*Ana | Relacionamento*\n");
  });

  it("cabeçalho torto (com * ou quebra de linha) é ignorado, nunca derruba o envio", () => {
    const torta = configAssinatura({
      assinatura_mensagens: { humanos: true, ia: true, cabecalhos: { ia: { titulo: "x*y", frase: "a" }, funcoes: { sdr: { emoji: "🚗", frase: "a\nb" } } } },
    });
    expect(linhaDeAssinatura(torta, "ai")).toBe("*Assistente Virtual*\n");
    expect(linhaDeAssinatura(torta, "user", "ana", "sdr")).toBe("*Ana | Relacionamento*\n");
  });

  it("a guarda de eco tira o cabeçalho inteiro", () => {
    for (const linha of [linhaDeAssinatura(c, "ai"), linhaDeAssinatura(c, "user", "paloma", "sdr")]) {
      expect(semAssinatura(aplicarAssinatura(linha, "oi\n> citação do cliente") ?? "")).toBe("oi\n> citação do cliente");
    }
  });
});

describe("v1.9.6 — nomes e menus do guardião e do Suporte IA", () => {
  it("só o texto muda: a chave segue 'sdr'", () => {
    expect(ROTULO_DA_FUNCAO.sdr).toBe("Guardião");
    expect(ROTULO_DA_FUNCAO.suporte).toBe("Suporte IA");
  });

  const menu = (funcao: "sdr" | "suporte") =>
    sidebarGroups(false, "agent", { preset: "completa", funcao })
      .filter((g) => g.group.id.startsWith("iavek-"))
      .flatMap((g) => g.items.map((i) => `${i.label} ${i.href}`));

  it("guardião: literalmente Meu dia · Meus leads · Agenda · Meus dados", () => {
    expect(menu("sdr")).toEqual([
      "Meu dia /app/meu-dia",
      "Meus leads /app/pipeline",
      "Agenda /app/agenda",
      "Meus dados /app/meus-numeros",
    ]);
  });

  it("Suporte IA: Meu dia · Atendimento da IA · Meus leads · Agenda · Meus dados (sem Espaço da IA)", () => {
    expect(menu("suporte")).toEqual([
      "Meu dia /app/meu-dia",
      "Atendimento da IA /app/inbox",
      "Meus leads /app/pipeline",
      "Agenda /app/agenda",
      "Meus dados /app/meus-numeros",
    ]);
    expect(DESTINOS_DA_FUNCAO.suporte).not.toContain("/app/espaco-ia");
  });

  it("saem Tarefas, Contatos, Chamadas, Respostas rápidas (e a Entrada de leads do guardião)", () => {
    for (const fora of ["/app/tasks", "/app/contacts", "/app/calls", "/app/templates"]) {
      expect(DESTINOS_DA_FUNCAO.sdr).not.toContain(fora);
      expect(DESTINOS_DA_FUNCAO.suporte).not.toContain(fora);
    }
    expect(DESTINOS_DA_FUNCAO.sdr).not.toContain("/app/inbox");
  });

  it("vendedor sem mudança", () => {
    expect(DESTINOS_DA_FUNCAO.vendedor).toContain("/app/tasks");
    expect(DESTINOS_DA_FUNCAO.vendedor).toContain("/app/inbox");
  });
});

describe("v1.9.6 — modelo da primeira mensagem", () => {
  const settings = { primeira_mensagem: { sdr: "Prazer {primeiro_nome}, {dia} às {hora}.", vendedor: "Fala {primeiro_nome}" } };

  it("só guardião e vendedor têm modelo, e só se a organização gravou", () => {
    expect(modeloDaFuncao(settings, "sdr")).toContain("Prazer");
    expect(modeloDaFuncao(settings, "vendedor")).toBe("Fala {primeiro_nome}");
    expect(modeloDaFuncao(settings, "gerente")).toBeNull();
    expect(modeloDaFuncao(settings, "suporte")).toBeNull();
    expect(modeloDaFuncao({}, "sdr")).toBeNull();
  });

  it("variável vazia não é inventada: fica visível para a pessoa preencher", () => {
    expect(preencherModelo("Prazer {primeiro_nome}, {dia} às {hora}.", { primeiro_nome: "Lucas" })).toBe(
      "Prazer Lucas, {dia} às {hora}.",
    );
    expect(primeiroNome("+55 11 99999")).toBeNull();
    expect(primeiroNome("maria clara")).toBe("Maria");
  });

  it("dia e hora no fuso da loja: hoje, amanhã ou dd/mm", () => {
    const agora = new Date("2026-10-30T15:00:00Z"); // 12:00 em São Paulo
    const fuso = "America/Sao_Paulo";
    expect(diaDoCompromisso(new Date("2026-10-30T20:00:00Z"), agora, fuso)).toBe("hoje");
    expect(diaDoCompromisso(new Date("2026-10-31T20:00:00Z"), agora, fuso)).toBe("amanhã");
    expect(diaDoCompromisso(new Date("2026-11-03T20:00:00Z"), agora, fuso)).toBe("03/11");
    expect(horaDoCompromisso(new Date("2026-10-31T20:00:00Z"), fuso)).toBe("17:00");
  });
});
