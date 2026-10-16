import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/automation/actions", () => ({ registerAction: vi.fn() }));

import type { ActionCtx } from "@/lib/automation/types";
import { adiarAvisoAte, executarAvisoGrupo, type DepsDoAvisoGrupo } from "./avisar-grupo";

const cfg = {
  channel_session_id: "00000000-0000-4000-8000-000000000001",
  group_chat_id: "120363000000000000@g.us",
  espacamento_segundos: 60,
  teto_diario: 2,
};
const agora = new Date("2026-10-16T13:00:00Z");
const ctx = {
  organizationId: "org",
  context: { contact: { name: "Juliana" }, lead: { title: "Onix 2018" } },
} as unknown as ActionCtx;

function deps(o: { cfg?: typeof cfg | null; total?: number; ultimo?: Date | null; numero?: Date | null; falha?: boolean }) {
  const enviados: string[] = [];
  const d: DepsDoAvisoGrupo = {
    agora: () => agora,
    config: async () => ({ cfg: o.cfg === undefined ? cfg : o.cfg, fuso: "America/Sao_Paulo" }),
    enviados: async () => ({ total: o.total ?? 0, ultimo: o.ultimo ?? null }),
    numeroLiberaEm: async () => o.numero ?? null,
    enviar: async (_org, _cfg, texto) => {
      if (o.falha) throw new Error("waha_fora");
      enviados.push(texto);
    },
  };
  return { d, enviados };
}

describe("avisar_grupo", () => {
  it("envia ao grupo com o prefixo do tipo e o template preenchido", async () => {
    const { d, enviados } = deps({});
    const r = await executarAvisoGrupo(ctx, { tipo: "comemoracao", texto: "{{contact.name}} agendou: {{lead.title}}" }, d);
    expect(r.status).toBe("success");
    expect(enviados).toEqual(["🎉 Juliana agendou: Onix 2018"]);
  });
  it("sem grupo configurado: pula e diz por quê, sem enviar", async () => {
    const { d, enviados } = deps({ cfg: null });
    const r = await executarAvisoGrupo(ctx, { tipo: "urgente", texto: "x" }, d);
    expect(r).toMatchObject({ status: "skipped", detail: { reason: "grupo_nao_configurado" } });
    expect(enviados).toEqual([]);
  });
  it("teto do dia: pula (não empurra para amanhã)", async () => {
    const { d, enviados } = deps({ total: 2 });
    const r = await executarAvisoGrupo(ctx, { tipo: "urgente", texto: "x" }, d);
    expect(r).toMatchObject({ status: "skipped", detail: { reason: "teto_diario" } });
    expect(enviados).toEqual([]);
    expect(await adiarAvisoAte(ctx, d)).toBeNull();
  });
  it("espaçamento do grupo e do número adiam o evento", async () => {
    expect(await adiarAvisoAte(ctx, deps({ total: 1, ultimo: new Date(agora.getTime() - 30_000) }).d)).toBe(
      new Date(agora.getTime() + 30_000).toISOString(),
    );
    const numero = new Date(agora.getTime() + 5_000);
    expect(await adiarAvisoAte(ctx, deps({ numero }).d)).toBe(numero.toISOString());
    expect(await adiarAvisoAte(ctx, deps({}).d)).toBeNull();
  });
  it("config da regra incompleta falha; falha de envio vira failed com o motivo", async () => {
    expect((await executarAvisoGrupo(ctx, { tipo: "x", texto: "y" }, deps({}).d)).status).toBe("failed");
    const r = await executarAvisoGrupo(ctx, { tipo: "observacao", texto: "y" }, deps({ falha: true }).d);
    expect(r).toMatchObject({ status: "failed", error: "waha_fora" });
  });
});
