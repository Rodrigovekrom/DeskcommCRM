/**
 * ia.vek v1.9.46 (0624): guardar a mídia por MAIS de 90 dias é um opcional (pago), e só o admin da PLATAFORMA liga.
 * A trava mora no banco (provada no TESTE, desfeita); aqui, as travas do texto e a tela.
 */
// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/settings/updateTenant", () => ({ updateTenant: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (k: string) => k }));

import { TenantForm } from "@/app/app/settings/tenant/_form";

const M = readFileSync("supabase/migrations/20261111233000_0624_iavek_retencao_acima_de_90_so_plataforma.sql", "utf8");
const inicial = {
  display_name: "Loja", legal_name: "Loja Ltda", cnpj: null, country: "BR", timezone: "America/Sao_Paulo", locale: "pt-BR",
  currency: "BRL", media_retention_days: 90, media_retention_enforced: true, dpo_email: null, privacy_policy_url: null,
} as never;

afterEach(cleanup);

describe("v1.9.46 (0624): a retenção acima de 90 dias só pela plataforma", () => {
  it("⭐ o banco: subir acima de 90 sem ser a plataforma é recusado; baixar ou deixar igual pode; o sistema pode", () => {
    expect(M).toMatch(/before update of media_retention_days on public\.organizations/);
    expect(M).toMatch(/new\.media_retention_days is distinct from old\.media_retention_days/);
    expect(M).toMatch(/new\.media_retention_days > 90/);
    expect(M).toMatch(/new\.media_retention_days > coalesce\(old\.media_retention_days, 0\)/); // baixar de 180 para 120 pode
    expect(M).toMatch(/auth\.uid\(\) is not null/); // o sistema (service_role, crons) não é barrado
    expect(M).toMatch(/not public\.fn_is_platform_admin\(\)/);
    expect(M).toMatch(/raise exception 'retencao_acima_de_90_so_plataforma'/);
  });

  it("⭐ a tela do admin da EMPRESA: o campo vai até 90 e o texto do opcional aparece", () => {
    render(<TenantForm initial={inicial} />);
    expect((document.getElementById("media_retention_days") as HTMLInputElement).max).toBe("90");
    expect(screen.getByTestId("retencao-opcional-pago").textContent).toBe("Guardar por mais de 90 dias é um opcional; fale com a ia.vek.");
  });

  it("a tela do admin da PLATAFORMA: até 3.650, sem o texto", () => {
    render(<TenantForm initial={inicial} podeAcimaDe90 />);
    expect((document.getElementById("media_retention_days") as HTMLInputElement).max).toBe("3650");
    expect(screen.queryByTestId("retencao-opcional-pago")).toBeNull();
  });

  it("a action traduz a recusa do banco no texto do opcional", () => {
    const a = readFileSync("app/actions/settings/updateTenant.ts", "utf8");
    expect(a).toMatch(/retencao_acima_de_90_so_plataforma[\s\S]{0,120}Guardar por mais de 90 dias é um opcional; fale com a ia\.vek\./);
  });
});

import { podeGuardarMidiaPor } from "@/lib/retencao/politica";

describe("v1.9.46 (0624): a trava de VERDADE, no servidor (o update vai com service_role)", () => {
  it("⭐ o admin da empresa: até 90 pode; acima de 90 não; baixar ou regravar o que a plataforma ligou pode", () => {
    expect(podeGuardarMidiaPor(90, 90, false)).toBe(true);
    expect(podeGuardarMidiaPor(30, 90, false)).toBe(true);
    expect(podeGuardarMidiaPor(91, 90, false)).toBe(false);
    expect(podeGuardarMidiaPor(365, 90, false)).toBe(false);
    expect(podeGuardarMidiaPor(180, 180, false)).toBe(true); // regravar os 180 da plataforma
    expect(podeGuardarMidiaPor(120, 180, false)).toBe(true); // baixar
    expect(podeGuardarMidiaPor(200, 180, false)).toBe(false); // subir mais
  });
  it("o admin da plataforma pode qualquer valor", () => {
    expect(podeGuardarMidiaPor(3650, 90, true)).toBe(true);
  });
  it("⭐ a action confere ANTES de gravar, com o valor atual, e devolve o texto do opcional", () => {
    const a = readFileSync("app/actions/settings/updateTenant.ts", "utf8");
    const conferencia = a.indexOf("podeGuardarMidiaPor(");
    const gravacao = a.indexOf('.from("organizations")\n    .update(');
    expect(conferencia).toBeGreaterThan(0);
    expect(conferencia).toBeLessThan(gravacao);
    expect(a).toMatch(/authUser\.is_platform_admin && !authUser\.support/);
  });
});
