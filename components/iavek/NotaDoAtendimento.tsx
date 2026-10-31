"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { TITULO_DOS_CRITERIOS } from "@/lib/iavek/nota-do-atendimento";
import { cn } from "@/lib/utils";

/**
 * ia.vek v1.8.4 — a NOTA DO ATENDIMENTO na tela. Só gerente e admin chegam
 * aqui (quem monta confere o papel; as rotas e a RLS barram o vendedor de novo).
 */

function corDaNota(n: number): string {
  if (n >= 8) return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (n >= 6) return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-red-300 bg-red-50 text-red-900";
}

const fmt = (n: number, idioma: string) => n.toLocaleString(idioma, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface NotaDaConversa {
  id: string;
  nota: number | string;
  pontos_fortes: string[];
  pontos_a_melhorar: string[];
  trecho: string | null;
  created_at: string;
}

/** O selo no cabeçalho da conversa: a última nota; tocar mostra o motivo. */
export function SeloDaNota({ conversationId }: { conversationId: string }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const { data } = useQuery({
    queryKey: ["iavek", "notas", conversationId],
    queryFn: () =>
      apiClient
        .get<ApiSuccess<NotaDaConversa[]>>(`/api/v1/iavek/notas?conversation_id=${conversationId}`)
        .then((r) => r.data),
    staleTime: 60_000,
  });
  const ultima = data?.[0];
  if (!ultima) return null;
  const n = Number(ultima.nota);
  return (
    <details className="relative text-[11px]" data-testid="selo-da-nota">
      <summary
        className={cn("inline-flex cursor-pointer list-none rounded-full border px-2 py-0.5 font-semibold", corDaNota(n))}
        title={ultima.pontos_a_melhorar.join(" · ")}
      >
        {t("Nota")} {fmt(n, idioma)}
      </summary>
      <div className="absolute z-20 mt-1 w-72 rounded-md border bg-background p-3 text-xs shadow-md" data-testid="motivo-da-nota">
        <p className="font-semibold">{t("Pontos fortes")}</p>
        <ul className="mb-2 list-disc pl-4">
          {ultima.pontos_fortes.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="font-semibold">{t("A melhorar")}</p>
        <ul className="mb-2 list-disc pl-4">
          {ultima.pontos_a_melhorar.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {ultima.trecho && <p className="italic text-muted-foreground">“{ultima.trecho}”</p>}
        {data && data.length > 1 && (
          <p className="mt-2 text-muted-foreground">
            {t("Notas anteriores nesta conversa:")} {data.slice(1).map((x) => fmt(Number(x.nota), idioma)).join(" · ")}
          </p>
        )}
      </div>
    </details>
  );
}

interface PainelDasNotas {
  ativo: boolean;
  vendedores: Array<{ vendedor_id: string; nome: string | null; media: number; atendimentos: number }>;
  piores: Array<{ id: string; conversation_id: string; vendedor: string | null; nota: number; a_melhorar: string | null; created_at: string }>;
}

/** "Nota dos atendimentos" no Meu dia do gerente: média da semana por vendedor e as 5 piores. */
export function NotasDaSemana() {
  const t = useT();
  const idioma = useTagDeIdioma();
  const { data } = useQuery({
    queryKey: ["iavek", "notas", "painel"],
    queryFn: () => apiClient.get<ApiSuccess<PainelDasNotas>>("/api/v1/iavek/notas/painel").then((r) => r.data),
    refetchInterval: 120_000,
  });
  if (!data?.ativo) return null;
  return (
    <section className="rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="notas-da-semana">
      <h2 className="mb-2 text-sm font-semibold">{t("Nota dos atendimentos (últimos 7 dias)")}</h2>
      {data.vendedores.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhum atendimento avaliado nos últimos 7 dias.")}</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {data.vendedores.map((v) => (
            <li key={v.vendedor_id} className="flex items-center gap-2" data-testid="media-do-vendedor">
              <span className={cn("rounded-full border px-2 text-xs font-semibold tabular-nums", corDaNota(v.media))}>{fmt(v.media, idioma)}</span>
              <span className="font-medium">{v.nome ?? "—"}</span>
              <span className="text-xs text-muted-foreground">
                ({v.atendimentos} {t("atendimentos")})
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.piores.length > 0 && (
        <>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("Piores notas")}</p>
          <ul className="space-y-1 text-xs">
            {data.piores.map((p) => (
              <li key={p.id} data-testid="pior-nota">
                <Link href={`/app/inbox?id=${p.conversation_id}`} className="hover:underline">
                  <span className="font-semibold tabular-nums">{fmt(p.nota, idioma)}</span> · {p.vendedor ?? "—"}
                  {p.a_melhorar ? ` — ${p.a_melhorar}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Configurações (só admin): "Dar nota ao atendimento do vendedor". */
export function NotaDoAtendimentoConfig() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["iavek", "nota-do-atendimento", "config"],
    queryFn: () => apiClient.get<ApiSuccess<{ ativo: boolean }>>("/api/v1/iavek/nota-do-atendimento").then((r) => r.data),
  });
  const gravar = useMutation({
    mutationFn: (ativo: boolean) => apiClient.patch("/api/v1/iavek/nota-do-atendimento", { ativo }),
    onError: showApiError,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["iavek", "nota-do-atendimento"] }),
  });
  return (
    <section className="space-y-2 rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="nota-do-atendimento-config">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={data?.ativo === true}
          disabled={!data || gravar.isPending}
          onChange={(e) => gravar.mutate(e.target.checked)}
          data-testid="ligar-nota-do-atendimento"
        />
        {t("Dar nota ao atendimento do vendedor (IA)")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t(
          "Ligado: quando o vendedor fecha uma conversa, uma IA separada lê o atendimento e dá uma nota de 0 a 10. Ela nunca fala com o cliente. Só gerente e admin veem as notas. Dados pessoais são mascarados antes de ir à IA.",
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("Critérios: crie no Acervo um material com o título")} <strong>{TITULO_DOS_CRITERIOS}</strong>.{" "}
        {t("Sem ele, vale o critério padrão da loja.")}
      </p>
    </section>
  );
}
