"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface Orientacao {
  id: string;
  conversation_id: string;
  texto: string;
  autor_nome: string | null;
  criada_em: string;
}

/**
 * ia.vek v1.9.13 — a chave do canal de orientação da IA e a fila da revisão semanal:
 * o que a equipe orientou fica aqui até alguém marcar se virou regra ou foi
 * descartado. Virar regra é trabalho de quem revisa; a IA não aprende sozinha.
 */
export function CanalDaIaConfig({ ehAdmin }: { ehAdmin: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const chave = ["iavek", "canal-ia"] as const;
  const fila = ["iavek", "orientacoes"] as const;
  const { data: canal } = useQuery({
    queryKey: chave,
    queryFn: () => apiClient.get<{ data: { ativo: boolean } }>("/api/v1/settings/canal-ia").then((r) => r.data),
  });
  const { data: lista } = useQuery({
    queryKey: fila,
    queryFn: () => apiClient.get<{ data: { orientacoes: Orientacao[] } }>("/api/v1/iavek/orientacoes").then((r) => r.data.orientacoes),
  });
  const trocar = useMutation({
    mutationFn: (ativo: boolean) => apiClient.patch("/api/v1/settings/canal-ia", { ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave }),
    onError: showApiError,
  });
  const revisar = useMutation({
    mutationFn: ({ id, revisao }: { id: string; revisao: "virou_regra" | "descartada" }) =>
      apiClient.patch(`/api/v1/iavek/orientacoes/${id}`, { revisao }),
    onSuccess: () => qc.invalidateQueries({ queryKey: fila }),
    onError: showApiError,
  });
  const ativo = canal?.ativo === true;
  return (
    <section className="space-y-3 rounded-lg border bg-surface/90 p-4 backdrop-blur" data-testid="canal-da-ia">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("Canal de orientação da IA")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("O Suporte IA orienta a IA na conversa e recebe no sino quando ela trava. Isto não liga a IA.")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={ativo ? "outline" : "default"}
          disabled={!ehAdmin || !canal || trocar.isPending}
          onClick={() => trocar.mutate(!ativo)}
          data-testid="canal-da-ia-chave"
        >
          {ativo ? t("Desligar") : t("Ligar")}
        </Button>
      </div>
      <p className="text-xs" data-testid="canal-da-ia-estado">
        {ativo ? t("Ligado nesta empresa.") : t("Desligado nesta empresa.")}
      </p>
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("Orientações para revisar")} ({lista?.length ?? 0})
        </h3>
        {(lista ?? []).map((o) => (
          <div key={o.id} className="rounded-md border p-2 text-sm" data-testid="orientacao-para-revisar">
            <p>{o.texto}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {o.autor_nome ?? "—"} · {new Date(o.criada_em).toLocaleString()}
            </p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={revisar.isPending} onClick={() => revisar.mutate({ id: o.id, revisao: "virou_regra" })}>
                {t("Virou regra")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={revisar.isPending} onClick={() => revisar.mutate({ id: o.id, revisao: "descartada" })}>
                {t("Descartar")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
