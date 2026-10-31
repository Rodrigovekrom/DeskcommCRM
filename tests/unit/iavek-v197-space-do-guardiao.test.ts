import { describe, expect, it } from "vitest";

import { DESTINOS_DA_FUNCAO } from "@/lib/iavek/funcoes";
import { estadoNoSpace, ordenarPorUrgencia, urgencia } from "@/lib/iavek/space-do-guardiao";
import { sidebarGroups } from "@/lib/navigation/registry";

const H = 3_600_000;
const agora = Date.parse("2026-10-30T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("v1.9.7 — Space do guardião: estado de cada lead", () => {
  it("Follow-up vence tudo; compromisso não corre; fora disso, o relógio decide", () => {
    expect(estadoNoSpace({ noFollowup: true, emCompromisso: true, fimDasHoras: agora + H, agora })).toBe("followup");
    expect(estadoNoSpace({ noFollowup: false, emCompromisso: true, fimDasHoras: agora - H, agora })).toBe("compromisso");
    expect(estadoNoSpace({ noFollowup: false, emCompromisso: false, fimDasHoras: agora - 1, agora })).toBe("vencido");
    expect(estadoNoSpace({ noFollowup: false, emCompromisso: false, fimDasHoras: agora + H, agora })).toBe("correndo");
  });

  it("a ordem: vencidos, depois o que vence primeiro, compromisso, e o Follow-up (mais recente no topo) no fim", () => {
    const linhas = [
      { id: "fu-velho", estado: "followup" as const, fim_das_horas: iso(agora - 50 * H) },
      { id: "folga", estado: "correndo" as const, fim_das_horas: iso(agora + 40 * H) },
      { id: "comp", estado: "compromisso" as const, fim_das_horas: iso(agora + 1 * H) },
      { id: "vencido", estado: "vencido" as const, fim_das_horas: iso(agora - 2 * H) },
      { id: "urgente", estado: "correndo" as const, fim_das_horas: iso(agora + 2 * H) },
      { id: "fu-novo", estado: "followup" as const, fim_das_horas: iso(agora - 3 * H) },
    ];
    expect(ordenarPorUrgencia(linhas).map((l) => l.id)).toEqual(["vencido", "urgente", "folga", "comp", "fu-novo", "fu-velho"]);
  });

  it("a cor segue a régua do selo das 72h (24h e 6h)", () => {
    expect(urgencia(30 * H)).toBe("folga");
    expect(urgencia(10 * H)).toBe("atencao");
    expect(urgencia(2 * H)).toBe("urgente");
  });
});

describe("v1.9.7 — o item no menu do guardião", () => {
  it("entre Meus leads e Agenda, com o nome 'Space do guardião'", () => {
    const menu = sidebarGroups(false, "agent", { preset: "completa", funcao: "sdr" })
      .filter((g) => g.group.id.startsWith("iavek-"))
      .flatMap((g) => g.items.map((i) => i.label));
    expect(menu).toEqual(["Meu dia", "Meus leads", "Space do guardião", "Agenda", "Meus dados"]);
  });

  it("só o guardião o tem no menu", () => {
    for (const f of ["vendedor", "suporte", "gerente"] as const) {
      expect(DESTINOS_DA_FUNCAO[f]).not.toContain("/app/space-do-guardiao");
    }
  });
});
