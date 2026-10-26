import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ausenciasDasExcecoes, corDoCompromisso } from "@/components/iavek/CoresDaAgenda";
import type { Agendamento, Pessoa } from "@/components/agenda/tipos";
import { capacidadePorHorario } from "@/lib/iavek/capacidade-da-agenda";
import { ehHorarioOcupado } from "@/app/api/v1/agenda/agendamentos/_handler";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

let modo = false;
vi.mock("@/hooks/iavek/usePerfilDaEmpresa", () => ({
  usePerfilDaEmpresa: () => ({ nicho: modo ? "clinica" : "loja_de_carros", modo_agendamento: modo, lojaDeCarros: !modo }),
}));
const { GradeDaAgenda } = await import("@/components/agenda/GradeDaAgenda");

afterEach(() => {
  cleanup();
  modo = false;
});

/** ia.vek v1.9.1 — modo agendamento (clínica): cores, capacidade, guarda e quem marca. */
describe("v1.9.1 — capacidade por horário", () => {
  const clinica = { iavek: { perfil: { nicho: "clinica", modo_agendamento: true } } };
  it("no modo agendamento é 1 por pessoa, mesmo com teto da loja gravado", () => {
    expect(capacidadePorHorario(clinica)).toBe(1);
    expect(capacidadePorHorario({ iavek: { ...clinica.iavek, agenda_capacidade_por_horario: 5 } })).toBe(1);
  });
  it("fora do modo (a loja), a regra da v1.7.6 continua: sem número = sem limite", () => {
    expect(capacidadePorHorario({})).toBeNull();
    expect(capacidadePorHorario({ iavek: { agenda_capacidade_por_horario: 3 } })).toBe(3);
    expect(capacidadePorHorario({ iavek: { perfil: { nicho: "clinica", modo_agendamento: false } } })).toBeNull();
  });
});

describe("v1.9.1 — a recusa do banco vira 409 só quando é o duplo", () => {
  it("PT409 + agenda_horario_ocupado = horário ocupado; outras PT409 (0363) não", () => {
    expect(ehHorarioOcupado({ code: "PT409", message: "agenda_horario_ocupado" })).toBe(true);
    expect(ehHorarioOcupado({ code: "PT409", message: "meet_stale" })).toBe(false);
    expect(ehHorarioOcupado({ code: "23505", message: "agenda_horario_ocupado" })).toBe(false);
    expect(ehHorarioOcupado(null)).toBe(false);
  });
});

describe("v1.9.1 — quem marca", () => {
  it("a rota: piso gerente, e fora do modo quem não é admin recebe a MESMA recusa de antes", () => {
    const r = ler("app/api/v1/agenda/agendamentos/route.ts");
    expect(r).toMatch(/role: "manager",/);
    expect(r).toContain("!(await modoAgendamentoDaOrg(authz.organizationId))");
    expect(r).toContain('fail("forbidden_role", "Permissão insuficiente. Requer role >= admin.", 403, { requestId })');
  });
  it("a barra da conversa: no modo, o gerente marca direto; fora dele, pede", () => {
    const f = ler("components/inbox/CRMSidePanel.tsx");
    expect(f).toContain('const marcaDireto = ehAdminDaLoja || (modo_agendamento && (activeOrg?.role === "manager"));');
  });
  it("a migration 0594 está no baseline, antes da VARREDURA anon", () => {
    const b = ler("supabase/baseline.sql");
    const i = b.indexOf("(migration 0594) ----");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(b.indexOf("-- ---- VARREDURA anon:"));
    expect(b).toContain("create trigger trg_iavek_agenda_sem_duplo");
  });
});

describe("v1.9.1 — as 4 cores", () => {
  it("verde = confirmado/realizado, amarelo = pendente; o resto fica como sempre", () => {
    expect(corDoCompromisso("confirmed")).toEqual(corDoCompromisso("completed"));
    expect(corDoCompromisso("pending")).not.toEqual(corDoCompromisso("confirmed"));
    expect(corDoCompromisso("cancelled")).toBeNull();
    expect(corDoCompromisso("no_show")).toBeNull();
  });

  it("ausências: só bloqueios (não aberturas) e só de quem está na grade", () => {
    const base = { exception_date: "2026-11-02", start_minute: 0, end_minute: 1440, reason: "Congresso" };
    const r = ausenciasDasExcecoes(
      [
        { ...base, user_id: "p1", is_unavailable: true },
        { ...base, user_id: "p1", is_unavailable: false },
        { ...base, user_id: "outra", is_unavailable: true },
      ],
      new Set(["p1"]),
    );
    expect(r).toEqual([{ dia: "2026-11-02", inicioMin: 0, fimMin: 1440, pessoaId: "p1", motivo: "Congresso" }]);
  });

  const DIA = "2026-11-02";
  const PESSOAS: Pessoa[] = [{ id: "p1", nome: "Dra. Ana", trilha: 1 }];
  const AGS: Agendamento[] = [
    { id: "a1", titulo: "Limpeza", responsavelId: "p1", comeca: `${DIA}T09:00:00`, termina: `${DIA}T09:30:00`, origem: "ui", situacao: "confirmed" } as Agendamento,
    { id: "a2", titulo: "Botox", responsavelId: "p1", comeca: `${DIA}T10:00:00`, termina: `${DIA}T10:30:00`, origem: "ui", situacao: "pending" } as Agendamento,
  ];
  const montar = () =>
    render(
      <GradeDaAgenda
        visao="dia"
        ancora={new Date(`${DIA}T12:00:00`)}
        agora={new Date(`${DIA}T07:30:00`)}
        fuso={Intl.DateTimeFormat().resolvedOptions().timeZone}
        pessoas={PESSOAS}
        agendamentos={AGS}
        ausencias={[{ dia: DIA, inicioMin: 14 * 60, fimMin: 16 * 60, pessoaId: "p1", motivo: null }]}
        interacao={{ horariosPorDia: { [DIA]: [{ instante: `${DIA}T11:00:00.000`, rotulo: "11:00" }] }, motivo: null, duracaoMin: 30, onMarcarEm: vi.fn() }}
      />,
    );

  it("no modo agendamento: legenda, verde, amarelo, cinza e azul na grade", () => {
    modo = true;
    const { container } = montar();
    expect(screen.getByTestId("legenda-da-agenda").textContent).toContain("Agendado 100%");
    expect(container.querySelector('button[data-estado="agendado"]')?.getAttribute("aria-label")).toContain("Limpeza");
    expect(container.querySelector('button[data-estado="pre_agendado"]')?.getAttribute("aria-label")).toContain("Botox");
    expect(screen.getAllByTestId("ausencia-na-grade")).toHaveLength(1);
    expect(container.querySelectorAll('[data-estado="livre"]').length).toBeGreaterThan(0);
  });

  it("fora do modo (a loja): nada disso aparece — a grade de sempre", () => {
    const { container } = montar();
    expect(screen.queryByTestId("legenda-da-agenda")).toBeNull();
    expect(container.querySelector("[data-estado]")).toBeNull();
    expect(screen.queryAllByTestId("ausencia-na-grade")).toHaveLength(0);
  });
});
