import { describe, expect, it } from "vitest";

import { abreATelaDeTarefas, funcaoDoDia, podePedirODia } from "@/lib/iavek/funcoes";

describe("v1.9.17: visão do dia por função", () => {
  const de = (funcao: string | null, role: string, administra = false) => ({ funcao, role, administra });

  it("cada um pede a própria", () => {
    expect(podePedirODia("vendedor", de("vendedor", "agent"))).toBe(true);
    expect(podePedirODia("sdr", de("sdr", "agent"))).toBe(true);
    expect(podePedirODia("suporte", de("suporte", "agent"))).toBe(true);
    expect(podePedirODia("gerente", de("gerente", "manager"))).toBe(true);
    expect(podePedirODia("gerente", de("apoio", "manager"))).toBe(true);
  });

  it("não pede a de outra função", () => {
    expect(podePedirODia("gerente", de("vendedor", "agent"))).toBe(false);
    expect(podePedirODia("sdr", de("vendedor", "agent"))).toBe(false);
    expect(podePedirODia("vendedor", de("gerente", "manager"))).toBe(false);
  });

  it("sem função, vale o dia que a tela abre", () => {
    expect(podePedirODia(funcaoDoDia(null, "agent"), de(null, "agent"))).toBe(true);
    expect(podePedirODia(funcaoDoDia(null, "manager"), de(null, "manager"))).toBe(true);
    expect(podePedirODia("gerente", de(null, "agent"))).toBe(false);
  });

  it("quem administra escolhe qualquer uma", () => {
    for (const f of ["sdr", "suporte", "vendedor", "gerente"]) {
      expect(podePedirODia(f, de(null, "admin", true))).toBe(true);
    }
    expect(podePedirODia("qualquer", de(null, "admin", true))).toBe(false);
  });
});

describe("v1.9.17: tela de Tarefas por função", () => {
  it("segue o menu para quem atende", () => {
    for (const f of ["vendedor", "sdr", "suporte"]) expect(abreATelaDeTarefas(f, "agent", false)).toBe(false);
  });
  it("gerência, administração e quem não usa função continuam", () => {
    expect(abreATelaDeTarefas("gerente", "manager", false)).toBe(true);
    expect(abreATelaDeTarefas(null, "admin", true)).toBe(true);
    expect(abreATelaDeTarefas("vendedor", "agent", true)).toBe(true);
    expect(abreATelaDeTarefas(null, "agent", false)).toBe(true);
  });
});
