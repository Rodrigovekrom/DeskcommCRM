import { describe, expect, it } from "vitest";
import { htmlDoRelatorio, montarRelatorio, textoDoRelatorio } from "./relatorio";

const fim = new Date("2026-10-19T11:00:00Z");
describe("relatório semanal", () => {
  it("agrega por pessoa: previstas, registradas, atendidas, agendamentos, sem interesse, atrasadas", () => {
    const linhas = montarRelatorio(
      [
        { assigned_to: "a", status: "done", due_date: "2026-10-14T12:00:00Z" },
        { assigned_to: "a", status: "pending", due_date: "2026-10-15T12:00:00Z" },
        { assigned_to: null, status: "pending", due_date: "2026-10-20T12:00:00Z" },
      ],
      [
        { performed_by_user_id: "a", payload: { atendeu: true, proximo: { tipo: "agendou" } } },
        { performed_by_user_id: "a", payload: { atendeu: false } },
        { performed_by_user_id: "b", payload: { atendeu: true, proximo: { tipo: "sem_interesse" } } },
      ],
      new Map([
        ["a", "Ana"],
        ["b", "Bruno"],
      ]),
      fim,
    );
    expect(linhas.find((l) => l.nome === "Ana")).toMatchObject({ previstas: 2, registradas: 2, atendidas: 1, agendadas: 1, atrasadas: 1 });
    expect(linhas.find((l) => l.nome === "Bruno")).toMatchObject({ registradas: 1, sem_interesse: 1, previstas: 0 });
    expect(linhas.find((l) => l.nome === "Sem responsável")).toMatchObject({ previstas: 1, atrasadas: 0 });
    expect(textoDoRelatorio(linhas, "12 a 18/10")).toContain("📊 Ligações da esteira (12 a 18/10)");
  });
  it("escapa nome no html", () => {
    const html = htmlDoRelatorio([{ usuario_id: "x", nome: "<b>", previstas: 0, registradas: 0, atendidas: 0, agendadas: 0, sem_interesse: 0, atrasadas: 0 }], "p");
    expect(html).toContain("&lt;b&gt;");
  });
  it("semana vazia diz que não houve ligação", () => {
    expect(textoDoRelatorio([], "p")).toContain("nenhuma ligação");
  });
});
