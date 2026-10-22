"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";

interface Membro {
  user_id: string;
  nome: string | null;
  funcao: string | null;
  role: string;
  participa: boolean;
}
interface Estado {
  ativo: boolean;
  participantes: string[];
  membros: Membro[];
  sem_dono: number;
}
interface Distribuicao {
  confirmado: boolean;
  total: number;
  por_pessoa: Array<{ user_id: string; nome: string | null; quantidade: number; mesmo_dono: number }>;
}

const CHAVE = ["iavek", "rodizio"] as const;

/**
 * ia.vek v1.7.7 — Rodízio de leads (só o admin).
 *
 * Diferente da "distribuição de conversas" desta mesma tela (que depende de
 * horário publicado e de presença): aqui é o LEAD novo que entra sem dono no
 * funil padrão e vai para o próximo vendedor marcado, na hora — e a conversa
 * livre do cliente vai junto, sem calar a IA.
 */
export function RodizioDeLeads() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<ApiSuccess<Estado>>("/api/v1/iavek/rodizio").then((r) => r.data),
  });
  const [previa, setPrevia] = useState<Distribuicao | null>(null);

  const salvar = useMutation({
    mutationFn: (corpo: { ativo?: boolean; participantes?: string[] }) => apiClient.patch("/api/v1/iavek/rodizio", corpo),
    onError: showApiError,
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
  const distribuir = useMutation({
    mutationFn: (confirmar: boolean) =>
      apiClient
        .post<ApiSuccess<Distribuicao>>("/api/v1/iavek/rodizio/distribuir", { confirmar })
        .then((r) => r.data),
    onSuccess: (r) => setPrevia(r.confirmado ? null : r),
    onError: showApiError,
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });

  if (!data) return null;
  const marcar = (userId: string, sim: boolean) => {
    const atuais = data.participantes.filter((p) => p !== userId);
    salvar.mutate({ participantes: sim ? [...atuais, userId] : atuais });
  };

  return (
    <section className="space-y-4 rounded-lg border p-4" data-testid="rodizio-de-leads">
      <div>
        <h2 className="text-lg font-semibold">{t("Rodízio de leads")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Cada lead novo que chega sem dono no funil padrão vai para o próximo vendedor marcado, na hora. Cliente que já tem dono continua com o mesmo dono. A conversa vai junto, sem calar a IA.",
          )}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch
          checked={data.ativo}
          disabled={salvar.isPending}
          onCheckedChange={(v) => salvar.mutate({ ativo: v })}
          data-testid="rodizio-ligado"
        />
        {data.ativo ? t("Rodízio ligado") : t("Rodízio desligado")}
      </label>

      <div className="space-y-1">
        <p className="text-sm font-medium">{t("Quem participa (na ordem em que foi marcado)")}</p>
        <ul className="divide-y rounded-md border">
          {data.membros.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="participante-do-rodizio">
              <input
                type="checkbox"
                className="size-4"
                checked={m.participa}
                disabled={salvar.isPending}
                onChange={(e) => marcar(m.user_id, e.target.checked)}
                aria-label={`${t("Participa do rodízio")}: ${m.nome ?? m.user_id}`}
              />
              <span className="flex-1 truncate">{m.nome ?? t("(sem nome)")}</span>
              {m.participa && (
                <span className="text-xs text-muted-foreground">
                  {t("posição")} {data.participantes.indexOf(m.user_id) + 1}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
        <p>
          {t("Leads antigos sem dono no funil padrão:")} <strong data-testid="rodizio-sem-dono">{data.sem_dono}</strong>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("Eles NÃO são distribuídos sozinhos. Veja a prévia e confirme.")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={distribuir.isPending || data.sem_dono === 0 || data.participantes.length === 0}
            onClick={() => distribuir.mutate(false)}
            data-testid="rodizio-previa"
          >
            {t("Distribuir os sem dono pelo rodízio")}
          </Button>
        </div>
        {previa && (
          <div className="space-y-2 rounded-md border bg-surface p-3" data-testid="rodizio-previa-resultado">
            <p className="font-medium">
              {t("Prévia")}: {previa.total} {t("leads")}
            </p>
            <ul className="text-sm">
              {previa.por_pessoa.map((p) => (
                <li key={p.user_id}>
                  {p.nome ?? p.user_id}: {p.quantidade}
                  {p.mesmo_dono > 0 ? ` (+${p.mesmo_dono} ${t("que já eram do cliente")})` : ""}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button size="sm" disabled={distribuir.isPending} onClick={() => distribuir.mutate(true)} data-testid="rodizio-confirmar">
                {t("Confirmar a distribuição")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPrevia(null)}>
                {t("Cancelar")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
