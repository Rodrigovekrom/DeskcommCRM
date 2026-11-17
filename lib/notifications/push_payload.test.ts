import { describe, expect, it } from "vitest";

import { CORPO_NEUTRO, conteudoDoAviso, montarPayloadDeInbound, pushDeveMostrarBandeja, truncar } from "./push_payload";

describe("push_payload", () => {
  it("trunca corpo longo", () => {
    expect(truncar("a".repeat(141)).endsWith("…")).toBe(true);
    expect(truncar("oi").length).toBe(2);
  });

  it("monta o href da conversa (e, de fábrica, 'so_nome': sem o texto e sem foto na tela de bloqueio)", () => {
    const p = montarPayloadDeInbound({ brand: "Clínica", conversationId: "c1", preview: "olá", icon: "https://x/foto.jpg" });
    expect(p.title).toBe("Nova mensagem");
    expect(p.href).toBe("/app/inbox?id=c1");
    expect(p.tag).toBe("msg:c1");
    expect(p.body).toBe(CORPO_NEUTRO);
    expect(p.icon).toBeUndefined();
  });

  it("CRM-530, decisão do Rodrigo: de fábrica o título é 'Nova mensagem de <nome>', sem o texto", () => {
    const p = montarPayloadDeInbound({ brand: "Clínica", conversationId: "c1", preview: "meu CPF é 123", contactName: "Maria" });
    expect(p.title).toBe("Nova mensagem de Maria");
    expect(p.body).toBe(CORPO_NEUTRO);
    expect(JSON.stringify(p)).not.toContain("CPF");
  });

  it("'completo': o nome no título, o texto e a foto (o de antes); 'nada': só 'Nova mensagem'", () => {
    const c = montarPayloadDeInbound({ brand: "C", conversationId: "c1", preview: "olá", contactName: "Maria", icon: "https://x/f.jpg", conteudo: "completo" });
    expect(c).toMatchObject({ title: "Maria", body: "olá", icon: "https://x/f.jpg" });
    const n = montarPayloadDeInbound({ brand: "C", conversationId: "c1", preview: "olá", contactName: "Maria", conteudo: "nada" });
    expect(n).toMatchObject({ title: "Nova mensagem", body: CORPO_NEUTRO });
    expect(JSON.stringify(n)).not.toContain("Maria");
  });

  it("a config da org: só 'completo' e 'nada' valem; o resto (ou ausente) é 'so_nome'", () => {
    expect(conteudoDoAviso(undefined)).toBe("so_nome");
    expect(conteudoDoAviso({ iavek: { push: { conteudo: "completo" } } })).toBe("completo");
    expect(conteudoDoAviso({ iavek: { push: { conteudo: "nada" } } })).toBe("nada");
    expect(conteudoDoAviso({ iavek: { push: { conteudo: "tudo" } } })).toBe("so_nome");
  });

  it("só mostra bandeja via push quando nenhum cliente está visível", () => {
    expect(pushDeveMostrarBandeja(0)).toBe(true);
    expect(pushDeveMostrarBandeja(1)).toBe(false);
  });
});
