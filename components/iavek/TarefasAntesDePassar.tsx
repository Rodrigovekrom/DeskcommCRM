"use client";
/**
 * ia.vek v1.9.62 (CRM-497, D4 1A/2A do Rodrigo) — o passo "Antes de passar: as tarefas deste lead".
 *
 * Quem PASSA o lead resolve antes cada tarefa aberta dele (de quem for): "Já fiz" (marca feita) ou "Excluir" (CANCELA
 * com o motivo 'excluida_ao_passar': fica na linha do tempo e volta se foi engano, em "Voltar"). "Resolver todas" faz o
 * que REGRAS_DA_PASSAGEM.resolverTodasComo diz (P2; hoje: feitas), depois de perguntar. As ligações automáticas da régua não aparecem: fecham sozinhas na passagem.
 * O botão de passar fica desligado até ZERO abertas (`aoMudarPronto`); o servidor confere de novo (409 tarefas_abertas).
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { REGRAS_DA_PASSAGEM } from "@/lib/iavek/regras-da-passagem";

interface TarefaDoPasso {
  id: string;
  title: string;
  assigned_to: string | null;
  due_date: string | null;
  status: string;
}
interface DadosDoPasso {
  abertas: TarefaDoPasso[];
  excluidas: TarefaDoPasso[];
}
type AcaoDaTarefa = "feita" | "excluir" | "voltar";

function vence(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function TarefasAntesDePassar({ leadId, aoMudarPronto }: { leadId: string; aoMudarPronto: (pronto: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const chave = ["iavek", "passagem", "tarefas", leadId];
  const { data, isLoading, isError } = useQuery({
    queryKey: chave,
    queryFn: () => apiClient.get<{ data: DadosDoPasso }>(`/api/v1/iavek/passagem/tarefas?lead_id=${leadId}`).then((r) => r.data),
  });
  const abertas = data?.abertas ?? [];
  const pronto = !isLoading && !isError && data !== undefined && abertas.length === 0;
  useEffect(() => {
    aoMudarPronto(pronto);
  }, [pronto, aoMudarPronto]);

  const mudar = useMutation({
    mutationFn: (args: { taskId: string; acao: AcaoDaTarefa }) =>
      apiClient.post("/api/v1/iavek/passagem/tarefas", { lead_id: leadId, task_id: args.taskId, acao: args.acao }),
    onSettled: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: showApiError,
  });

  async function resolverTodas() {
    // P2 do Rodrigo (o ponto único em lib/iavek/regras-da-passagem.ts): feitas ou canceladas
    const acao = REGRAS_DA_PASSAGEM.resolverTodasComo;
    const pergunta =
      acao === "feita"
        ? t("Marcar TODAS as tarefas abertas deste lead como feitas?")
        : t("Cancelar TODAS as tarefas abertas deste lead (dá para voltar)?");
    if (!window.confirm(pergunta)) return;
    for (const tarefa of abertas) {
      // uma por vez: cada uma é uma escrita conferida no servidor (a tarefa tem de ser deste lead e estar aberta)
      await mudar.mutateAsync({ taskId: tarefa.id, acao }).catch(() => undefined);
    }
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">{t("Conferindo as tarefas do lead…")}</p>;
  if (isError) return <p className="text-xs text-destructive">{t("Não consegui ler as tarefas.")}</p>;

  return (
    <div className="space-y-2 rounded-md border border-border p-2 text-xs" data-testid="tarefas-antes-de-passar">
      <p className="font-medium">{t("Antes de passar: as tarefas deste lead")}</p>
      {abertas.length === 0 ? (
        <p className="text-muted-foreground" data-testid="tarefas-antes-de-passar-zero">
          {t("Nenhuma tarefa aberta. O lead vai limpo para quem recebe.")}
        </p>
      ) : (
        <>
          <p className="text-amber-700 dark:text-amber-400">
            {t("Resolva cada tarefa antes de passar: depois da passagem, nenhuma tarefa vai para quem recebe.")}
          </p>
          <ul className="space-y-1">
            {abertas.map((tarefa) => (
              <li key={tarefa.id} className="flex flex-wrap items-center justify-between gap-1" data-testid="tarefa-aberta">
                <span>
                  {tarefa.title}
                  {tarefa.due_date ? <span className="text-muted-foreground"> · {vence(tarefa.due_date)}</span> : null}
                </span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    disabled={mudar.isPending}
                    onClick={() => mudar.mutate({ taskId: tarefa.id, acao: "feita" })}
                    data-testid="tarefa-ja-fiz"
                  >
                    {t("Já fiz")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    disabled={mudar.isPending}
                    onClick={() => mudar.mutate({ taskId: tarefa.id, acao: "excluir" })}
                    data-testid="tarefa-excluir"
                  >
                    {t("Excluir")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" disabled={mudar.isPending} onClick={() => void resolverTodas()} data-testid="tarefas-resolver-todas">
            {t("Resolver todas")}
          </Button>
        </>
      )}
      {(data?.excluidas ?? []).length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">{t("Excluídas ao passar (dá para voltar)")}</summary>
          <ul className="mt-1 space-y-1">
            {(data?.excluidas ?? []).map((tarefa) => (
              <li key={tarefa.id} className="flex flex-wrap items-center justify-between gap-1">
                <span className="line-through">{tarefa.title}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  disabled={mudar.isPending}
                  onClick={() => mudar.mutate({ taskId: tarefa.id, acao: "voltar" })}
                  data-testid="tarefa-voltar"
                >
                  {t("Voltar")}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
