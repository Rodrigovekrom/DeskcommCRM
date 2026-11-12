/**
 * ia.vek v1.9.47 (0627): saber se o e-mail CHEGOU — a assinatura Svix do webhook da Resend, o estado que só sobe,
 * o id de fora ignorado, o registro no envio e o que a tela de Equipe diz.
 */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  aplicarEventoDeEntrega,
  conferirAssinaturaDoWebhook,
  limparDetalhe,
  registrarEnvioDeEmail,
} from "@/lib/email/entregas";
import { rotuloDaEntrega } from "@/lib/email/entrega-na-tela";

const SEGREDO = `whsec_${Buffer.from("segredo-de-teste-0627-com-32-bytes!").toString("base64")}`;
function assinar(id: string, ts: string, corpo: string, segredo = SEGREDO): string {
  const chave = Buffer.from(segredo.slice(6), "base64");
  return `v1,${createHmac("sha256", chave).update(`${id}.${ts}.${corpo}`).digest("base64")}`;
}

describe("a assinatura do webhook (Svix)", () => {
  const corpo = '{"type":"email.delivered","data":{"email_id":"e1"}}';
  const agoraS = 1_800_000_000;
  const ts = String(agoraS);
  it("aceita a assinatura certa (também no meio de várias)", () => {
    expect(conferirAssinaturaDoWebhook({ segredo: SEGREDO, id: "msg_1", timestamp: ts, assinatura: assinar("msg_1", ts, corpo), corpo, agoraS })).toEqual({ ok: true });
    expect(conferirAssinaturaDoWebhook({ segredo: SEGREDO, id: "msg_1", timestamp: ts, assinatura: `v1,AAAA ${assinar("msg_1", ts, corpo)}`, corpo, agoraS }).ok).toBe(true);
  });
  it("recusa corpo mexido, outro id, outro segredo", () => {
    const a = assinar("msg_1", ts, corpo);
    expect(conferirAssinaturaDoWebhook({ segredo: SEGREDO, id: "msg_1", timestamp: ts, assinatura: a, corpo: corpo.replace("delivered", "bounced"), agoraS })).toEqual({ ok: false, motivo: "assinatura" });
    expect(conferirAssinaturaDoWebhook({ segredo: SEGREDO, id: "msg_2", timestamp: ts, assinatura: a, corpo, agoraS })).toEqual({ ok: false, motivo: "assinatura" });
    const outro = `whsec_${Buffer.from("outro-segredo-qualquer-de-32-bytes").toString("base64")}`;
    expect(conferirAssinaturaDoWebhook({ segredo: outro, id: "msg_1", timestamp: ts, assinatura: a, corpo, agoraS })).toEqual({ ok: false, motivo: "assinatura" });
  });
  it("recusa relógio fora de 5 min (evento velho reenviado)", () => {
    const velho = String(agoraS - 301);
    expect(conferirAssinaturaDoWebhook({ segredo: SEGREDO, id: "m", timestamp: velho, assinatura: assinar("m", velho, corpo), corpo, agoraS })).toEqual({ ok: false, motivo: "relogio" });
  });
  it("falha fechada: sem segredo ou sem cabeçalho, nada passa", () => {
    expect(conferirAssinaturaDoWebhook({ segredo: "", id: "m", timestamp: ts, assinatura: assinar("m", ts, corpo), corpo, agoraS })).toEqual({ ok: false, motivo: "sem_segredo" });
    expect(conferirAssinaturaDoWebhook({ segredo: SEGREDO, id: null, timestamp: ts, assinatura: "x", corpo, agoraS })).toEqual({ ok: false, motivo: "cabecalho_faltando" });
  });
});

/** Um dublê da tabela, com o update condicional no estado de antes. */
function tabela(inicial: Record<string, { estado: string }>) {
  const linhas = new Map(Object.entries(inicial).map(([k, v]) => [k, { ...v, detalhe: null as string | null }]));
  const upserts: unknown[] = [];
  const admin = {
    from: () => {
      const filtros: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((filtros[c] = v), q),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        upsert: async (p: unknown) => (upserts.push(p), { error: null }),
        maybeSingle: async () => {
          const l = linhas.get(String(filtros.mensagem_id));
          if (!l) return { data: null, error: null };
          if (patch) {
            if (filtros.estado !== undefined && l.estado !== filtros.estado) return { data: null, error: null };
            Object.assign(l, patch);
            return { data: { mensagem_id: filtros.mensagem_id }, error: null };
          }
          return { data: { estado: l.estado }, error: null };
        },
      };
      return q;
    },
  };
  return { admin: admin as never, linhas, upserts };
}

describe("o evento de entrega", () => {
  it("entregue sobe; um 'enviado' atrasado não desce", async () => {
    const t = tabela({ e1: { estado: "enviado" } });
    expect(await aplicarEventoDeEntrega(t.admin, { type: "email.delivered", data: { email_id: "e1" } })).toEqual({ aplicado: true, estado: "entregue" });
    expect(await aplicarEventoDeEntrega(t.admin, { type: "email.sent", data: { email_id: "e1" } })).toEqual({ aplicado: false, motivo: "estado_nao_sobe" });
    expect(t.linhas.get("e1")?.estado).toBe("entregue");
  });
  it("voltou guarda o motivo SEM o e-mail; um 'entregue' depois não apaga o voltou", async () => {
    const t = tabela({ e1: { estado: "enviado" } });
    await aplicarEventoDeEntrega(t.admin, { type: "email.bounced", data: { email_id: "e1", bounce: { message: "550 fulano@loja.com.br não existe\r\n" } } });
    expect(t.linhas.get("e1")).toMatchObject({ estado: "voltou", detalhe: "550 <email> não existe" });
    expect((await aplicarEventoDeEntrega(t.admin, { type: "email.delivered", data: { email_id: "e1" } })).aplicado).toBe(false);
    expect(t.linhas.get("e1")?.estado).toBe("voltou");
  });
  it("id que não é nosso: ignorado, nada é criado", async () => {
    const t = tabela({});
    expect(await aplicarEventoDeEntrega(t.admin, { type: "email.delivered", data: { email_id: "de-fora" } })).toEqual({ aplicado: false, motivo: "id_desconhecido" });
    expect(t.linhas.size).toBe(0);
    expect(t.upserts).toHaveLength(0);
  });
  it("aberto e clicado não contam; sem id não conta", async () => {
    const t = tabela({ e1: { estado: "enviado" } });
    expect(await aplicarEventoDeEntrega(t.admin, { type: "email.opened", data: { email_id: "e1" } })).toEqual({ aplicado: false, motivo: "evento_que_nao_conta" });
    expect(await aplicarEventoDeEntrega(t.admin, { type: "email.delivered", data: {} })).toEqual({ aplicado: false, motivo: "sem_id" });
  });
  it("spam vale como problema final", async () => {
    const t = tabela({ e1: { estado: "entregue" } });
    expect(await aplicarEventoDeEntrega(t.admin, { type: "email.complained", data: { email_id: "e1" } })).toEqual({ aplicado: true, estado: "spam" });
  });
  it("limparDetalhe corta e tira e-mail", () => {
    expect(limparDetalhe("x".repeat(400))).toHaveLength(300);
    expect(limparDetalhe(42)).toBeNull();
  });
});

describe("o registro no envio", () => {
  it("grava o id, a organização (só uuid) e o convite; nunca lança", async () => {
    const t = tabela({});
    await registrarEnvioDeEmail(t.admin, "re_123", { organizationId: "11111111-1111-4111-8111-111111111111", tipo: "team_invite", recursoId: "inv-1" });
    expect(t.upserts[0]).toMatchObject({ mensagem_id: "re_123", organization_id: "11111111-1111-4111-8111-111111111111", tipo: "team_invite", recurso_id: "inv-1" });
    await registrarEnvioDeEmail(t.admin, "re_124", { organizationId: "não-é-uuid" });
    expect(t.upserts[1]).toMatchObject({ organization_id: null });
    const quebrado = { from: () => { throw new Error("rede"); } } as never;
    await expect(registrarEnvioDeEmail(quebrado, "re_125", {})).resolves.toBeUndefined();
  });
});

describe("a tela de Equipe", () => {
  it("diz a entrega; voltou, spam e falhou são problema (vermelho com o Copiar link)", () => {
    expect(rotuloDaEntrega(null)).toEqual({ texto: "Sim", problema: false });
    expect(rotuloDaEntrega({ estado: "enviado", detalhe: null })).toEqual({ texto: "Sim", problema: false });
    expect(rotuloDaEntrega({ estado: "entregue", detalhe: null })).toEqual({ texto: "Entregue", problema: false });
    expect(rotuloDaEntrega({ estado: "voltou", detalhe: null }).problema).toBe(true);
    expect(rotuloDaEntrega({ estado: "spam", detalhe: null }).problema).toBe(true);
    expect(rotuloDaEntrega({ estado: "falhou", detalhe: null }).problema).toBe(true);
  });
});

