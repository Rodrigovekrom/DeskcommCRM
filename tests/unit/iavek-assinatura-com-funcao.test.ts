/**
 * ia.vek v1.7.2: a assinatura do humano leva a FUNÇÃO para o cliente
 * (`*Nome | Rótulo*`), com rótulos configuráveis por organização. Sem função,
 * só o nome (como antes). A guarda de eco continua reconhecendo a linha.
 */
import { describe, expect, it } from "vitest";
import {
  ROTULOS_FUNCAO_PADRAO,
  assinaturaEntradaSchema,
  configAssinatura,
  linhaDeAssinatura,
  semAssinatura,
} from "@/lib/messaging/assinatura";

const ligada = (rotulos?: Record<string, unknown>) =>
  configAssinatura({
    assinatura_mensagens: {
      humanos: true,
      ia: true,
      nome_ia: "Juliana | Primeiro Atendimento",
      ...(rotulos ? { rotulos_funcao: rotulos } : {}),
    },
  });

describe("assinatura do humano com a função", () => {
  it("usa os rótulos padrão combinados", () => {
    const c = ligada();
    expect(linhaDeAssinatura(c, "user", "bruno silva", "vendedor")).toBe(
      "*Bruno Silva | Consultor de Vendas*\n",
    );
    expect(linhaDeAssinatura(c, "user", "ana", "sdr")).toBe("*Ana | Relacionamento*\n");
    expect(linhaDeAssinatura(c, "user", "ana", "suporte")).toBe("*Ana | Atendimento*\n");
    expect(linhaDeAssinatura(c, "user", "rui", "gerente")).toBe("*Rui | Gerente*\n");
    expect(linhaDeAssinatura(c, "user", "rui", "apoio")).toBe("*Rui | Gerente de Negócios*\n");
    expect(ROTULOS_FUNCAO_PADRAO.vendedor).toBe("Consultor de Vendas");
  });

  it("sem função (ex.: admin), só o nome, como antes", () => {
    expect(linhaDeAssinatura(ligada(), "user", "rodrigo", null)).toBe("*Rodrigo*\n");
    expect(linhaDeAssinatura(ligada(), "user", "rodrigo")).toBe("*Rodrigo*\n");
  });

  it("a organização troca o rótulo; rótulo inválido (com * ou quebra) cai no padrão", () => {
    const c = ligada({ vendedor: "Consultora", sdr: "Pré*venda", gerente: "Ger\nente" });
    expect(linhaDeAssinatura(c, "user", "bia", "vendedor")).toBe("*Bia | Consultora*\n");
    expect(linhaDeAssinatura(c, "user", "bia", "sdr")).toBe("*Bia | Relacionamento*\n");
    expect(linhaDeAssinatura(c, "user", "bia", "gerente")).toBe("*Bia | Gerente*\n");
  });

  it("a IA continua com o nome configurado", () => {
    expect(linhaDeAssinatura(ligada(), "ai")).toBe("*Juliana | Primeiro Atendimento*\n");
  });

  it("a guarda de eco reconhece a linha com a função", () => {
    expect(semAssinatura("*Bruno Silva | Consultor de Vendas*\nOlá, tudo bem?")).toBe(
      "Olá, tudo bem?",
    );
  });

  it("a tela grava rótulos sem * nem quebra de linha, e o campo é opcional", () => {
    const base = { humanos: true, ia: true, nome_ia: "Juliana" };
    expect(assinaturaEntradaSchema.safeParse(base).success).toBe(true);
    expect(
      assinaturaEntradaSchema.safeParse({ ...base, rotulos_funcao: { vendedor: "Consultor" } })
        .success,
    ).toBe(true);
    expect(
      assinaturaEntradaSchema.safeParse({ ...base, rotulos_funcao: { vendedor: "Con*sultor" } })
        .success,
    ).toBe(false);
    expect(
      assinaturaEntradaSchema.safeParse({ ...base, rotulos_funcao: { caixa: "X" } }).success,
    ).toBe(false);
  });
});
