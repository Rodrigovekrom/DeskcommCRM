/**
 * ia.vek v1.9.60 (CRM-485): com a organização ligando (settings.iavek.manipulacao.bloquear_no_alto), o turno com
 * manipulação de nível ALTO não responde e vai para uma pessoa. DESLIGADO por padrão: aí o classificador segue
 * advisório, como antes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { bloqueioDeManipulacaoLigado, bloqueioLigadoNasConfiguracoes } from "@/lib/agent-engine/guardrails/jailbreak/bloqueio";
import { FRASE_DO_MOTIVO, MOTIVOS_DA_PASSAGEM, ORIGENS_DA_PASSAGEM } from "@/lib/escalacao/passagem";

describe("v1.9.60 (CRM-485): o interruptor do bloqueio", () => {
  it("só liga com true; ausente, string ou outro valor = desligado", () => {
    expect(bloqueioLigadoNasConfiguracoes(undefined)).toBe(false);
    expect(bloqueioLigadoNasConfiguracoes({})).toBe(false);
    expect(bloqueioLigadoNasConfiguracoes({ iavek: { manipulacao: { bloquear_no_alto: "true" } } })).toBe(false);
    expect(bloqueioLigadoNasConfiguracoes({ iavek: { manipulacao: { bloquear_no_alto: true } } })).toBe(true);
  });

  it("lê a organização certa e, sem leitura, vale o desligado (nunca lança)", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ settings: { iavek: { manipulacao: { bloquear_no_alto: true } } } }] })) };
    expect(await bloqueioDeManipulacaoLigado(pool as never, "org-1")).toBe(true);
    expect(pool.query).toHaveBeenCalledWith("select settings from organizations where id = $1", ["org-1"]);
    const quebrado = { query: vi.fn(async () => { throw new Error("banco fora"); }) };
    expect(await bloqueioDeManipulacaoLigado(quebrado as never, "org-1")).toBe(false);
  });
});

describe("v1.9.60 (CRM-485): o ramo do turno", () => {
  const fonte = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
  const i = fonte.lastIndexOf("ia.vek v1.9.60 (CRM-485): MANIPULAÇÃO FORTE SEGURA A RESPOSTA");
  const ramo = fonte.slice(i, fonte.indexOf("return;", i) + "return;".length);

  it("existe, depois do veredito final e da observação do Jev", () => {
    expect(i).toBeGreaterThan(fonte.lastIndexOf("jailbreakLevel = nivelFinalDaManipulacao("));
    expect(i).toBeGreaterThan(fonte.lastIndexOf("await gravarOJev("));
  });

  it("só no nível ALTO, fora da prévia, e com o interruptor ligado", () => {
    expect(ramo).toMatch(/!preview &&\s+jailbreakLevel === JAILBREAK_ESCALATION_LEVEL &&\s+\(await bloqueioDeManipulacaoLigado\(pool, tenantId\)\)/);
  });

  it("passa para uma pessoa com origem e motivo próprios, e SAI do turno sem responder", () => {
    expect(ramo).toContain("passagem: { origem: 'bloqueio_de_manipulacao', motivoCodigo: 'manipulacao', briefing }");
    expect(ramo).toContain("pendentesDoCliente: inboundsPendentes");
    expect(ramo.trim().endsWith("return;")).toBe(true);
    expect(ramo).not.toContain("avisarLead");
  });

  it("o vocabulário tem os dois códigos, com frase para a tela, e a 0645 os inclui", () => {
    expect(ORIGENS_DA_PASSAGEM).toContain("bloqueio_de_manipulacao");
    expect(MOTIVOS_DA_PASSAGEM).toContain("manipulacao");
    expect(FRASE_DO_MOTIVO.manipulacao).toMatch(/segurada/);
    const mig = readFileSync(join(process.cwd(), "supabase/migrations/20261117160000_0645_iavek_passagem_por_falha_da_ia.sql"), "utf8");
    const checks = mig.slice(mig.lastIndexOf("alter table public.passagens_de_atendimento\n  drop constraint if exists passagens_de_atendimento_origem_check"));
    expect(checks).toContain("'bloqueio_de_manipulacao'");
    expect(checks).toContain("'manipulacao'");
  });
});
