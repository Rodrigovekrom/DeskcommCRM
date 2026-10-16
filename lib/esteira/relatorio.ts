/**
 * RELATÓRIO SEMANAL POR VENDEDOR (ia.vek D3) — o que cada pessoa fez com as
 * ligações da esteira na semana. Vai para o destinatário configurado
 * (`settings.esteira.relatorio_semanal`, papel ou usuário), pela Central e por
 * e-mail quando o e-mail da instalação está configurado.
 *
 * A agregação é pura (testada); quem busca os dados e entrega é o cron.
 */
export interface TarefaDaSemana {
  assigned_to: string | null;
  status: string;
  due_date: string | null;
}

export interface RegistroDaSemana {
  performed_by_user_id: string | null;
  payload: { atendeu?: boolean; proximo?: { tipo?: string } | null } | null;
}

export interface LinhaDoRelatorio {
  usuario_id: string | null;
  nome: string;
  previstas: number;
  registradas: number;
  atendidas: number;
  agendadas: number;
  sem_interesse: number;
  atrasadas: number;
}

export function montarRelatorio(
  tarefas: TarefaDaSemana[],
  registros: RegistroDaSemana[],
  nomes: Map<string, string>,
  fim: Date,
): LinhaDoRelatorio[] {
  const linhas = new Map<string, LinhaDoRelatorio>();
  const linha = (u: string | null) => {
    const k = u ?? "";
    if (!linhas.has(k)) {
      linhas.set(k, {
        usuario_id: u,
        nome: u ? (nomes.get(u) ?? "Sem nome") : "Sem responsável",
        previstas: 0,
        registradas: 0,
        atendidas: 0,
        agendadas: 0,
        sem_interesse: 0,
        atrasadas: 0,
      });
    }
    return linhas.get(k)!;
  };
  for (const t of tarefas) {
    const l = linha(t.assigned_to);
    l.previstas += 1;
    const aberta = t.status === "pending" || t.status === "in_progress";
    if (aberta && t.due_date && new Date(t.due_date) < fim) l.atrasadas += 1;
  }
  for (const r of registros) {
    const l = linha(r.performed_by_user_id);
    l.registradas += 1;
    if (r.payload?.atendeu) l.atendidas += 1;
    if (r.payload?.proximo?.tipo === "agendou") l.agendadas += 1;
    if (r.payload?.proximo?.tipo === "sem_interesse") l.sem_interesse += 1;
  }
  return [...linhas.values()].sort((a, b) => b.registradas - a.registradas || a.nome.localeCompare(b.nome));
}

export function textoDoRelatorio(linhas: LinhaDoRelatorio[], periodo: string): string {
  if (linhas.length === 0) return `📊 Ligações da esteira (${periodo}): nenhuma ligação prevista nem registrada.`;
  const corpo = linhas.map(
    (l) =>
      `• ${l.nome}: ${l.registradas} registradas de ${l.previstas} previstas · ${l.atendidas} atendidas · ` +
      `${l.agendadas} agendamentos · ${l.sem_interesse} sem interesse · ${l.atrasadas} atrasadas`,
  );
  return [`📊 Ligações da esteira (${periodo})`, ...corpo].join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function htmlDoRelatorio(linhas: LinhaDoRelatorio[], periodo: string): string {
  const cab = ["Pessoa", "Previstas", "Registradas", "Atendidas", "Agendamentos", "Sem interesse", "Atrasadas"];
  const th = cab.map((c) => `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid #ddd">${c}</th>`).join("");
  const trs = linhas
    .map((l) => {
      const v = [esc(l.nome), l.previstas, l.registradas, l.atendidas, l.agendadas, l.sem_interesse, l.atrasadas];
      return `<tr>${v.map((x) => `<td style="padding:6px 10px;border-bottom:1px solid #eee">${x}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<div style="font-family:Arial,sans-serif;color:#111"><h2 style="font-size:18px">Ligações da esteira — ${esc(periodo)}</h2><table style="border-collapse:collapse;font-size:14px"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}
