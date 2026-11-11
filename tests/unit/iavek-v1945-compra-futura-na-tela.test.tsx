/**
 * ia.vek v1.9.45 (CRM-294): levar o lead para a Compra futura pede o MÊS e o ANO previstos. A janela
 * não deixa escolher mês passado; o schema só aceita "AAAA-MM"; a rota grava o dia 1 NA MESMA escrita
 * que muda a etapa e traduz as recusas do banco (sem mês, mês no passado) em 422 de negócio.
 */
import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompraFuturaDialog, mesAtual, mesValido } from "@/components/kanban/CompraFuturaDialog";
import { moveLeadSchema } from "@/lib/schemas/leads";

afterEach(cleanup);

describe("v1.9.45 (CRM-294): a janela da Compra futura", () => {
  it("⭐ SEM mês confirma (o mês é opcional desde 11/11) e manda null", () => {
    const onConfirm = vi.fn();
    render(<CompraFuturaDialog open onOpenChange={() => {}} onConfirm={onConfirm} />);
    const confirmar = screen.getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("⭐ mês passado não confirma; mês futuro confirma com 'AAAA-MM'", () => {
    const onConfirm = vi.fn();
    render(<CompraFuturaDialog open onOpenChange={() => {}} onConfirm={onConfirm} />);
    const confirmar = screen.getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("compra-futura-mes"), { target: { value: "2020-01" } });
    expect(confirmar.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("não pode estar no passado");
    fireEvent.change(screen.getByTestId("compra-futura-mes"), { target: { value: "2099-03" } });
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    expect(onConfirm).toHaveBeenCalledWith("2099-03");
  });

  it("o mês atual vale (não é passado), no fuso de São Paulo", () => {
    expect(mesAtual(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10"); // 23h de 31/10 em SP
    expect(mesValido("2026-11", new Date("2026-11-15T12:00:00Z"))).toBe(true);
    expect(mesValido("2026-10", new Date("2026-11-15T12:00:00Z"))).toBe(false);
  });
});

describe("v1.9.45 (CRM-294): o schema e a rota de mover", () => {
  const base = { stage_id: "11111111-1111-4111-8111-111111111111", position_in_stage: 1000, expected_updated_at: "2026-11-11T12:00:00.000Z" };
  it("o schema aceita 'AAAA-MM' e recusa o resto", () => {
    expect(moveLeadSchema.safeParse({ ...base, compra_futura_mes: "2027-03" }).success).toBe(true);
    expect(moveLeadSchema.safeParse({ ...base, compra_futura_mes: "2027-13" }).success).toBe(false);
    expect(moveLeadSchema.safeParse({ ...base, compra_futura_mes: "março" }).success).toBe(false);
  });

  it("⭐ a rota grava o dia 1 NA MESMA escrita e traduz as recusas do banco", () => {
    const rota = readFileSync("app/api/v1/leads/[id]/move/route.ts", "utf8");
    expect(rota).toMatch(/select\("id, pipeline_id, name, is_lost, is_won, is_compra_futura"\)/);
    expect(rota).toMatch(/compra_futura_mes: `\$\{input\.compra_futura_mes\}-01`/);
    expect(rota).toMatch(/compra_futura_mes_required[\s\S]{0,200}422/);
    expect(rota).toMatch(/compra_futura_mes_no_passado[\s\S]{0,200}422/);
  });

  it("o quadro abre a janela ao entrar numa etapa de Compra futura", () => {
    const q = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");
    expect(q).toMatch(/if \(etapa\.is_compra_futura && mudaDeEtapa\) \{\s*setCompraFuturaPendente/);
    expect(q).toMatch(/compraFuturaMes: mes/);
  });
});
