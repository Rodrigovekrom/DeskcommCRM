"use client";

/**
 * Estoque do Altimus (ia.vek v1.2): liga esta organização como DONA do estoque.
 * A URL (com a chave de acesso) é da instalação, em Admin › Configuração ›
 * Integrações, e nunca aparece aqui; esta tela só diz se ela existe.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";

interface EstadoAltimus {
  ativa: boolean | null;
  url_configurada: boolean;
  sincroniza_aqui: boolean;
  outra_organizacao_ligada: boolean;
}

const CHAVE = ["settings", "altimus"] as const;

export function AltimusDaOrganizacao() {
  const t = useT();
  const qc = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const { data, isLoading } = useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (await apiClient.get<{ data: { altimus: EstadoAltimus } }>("/api/v1/settings/altimus")).data
        .altimus,
  });

  function gravar(ativa: boolean) {
    startTransition(async () => {
      try {
        const r = await apiClient.patch<{ data: { altimus: EstadoAltimus } }>(
          "/api/v1/settings/altimus",
          { ativa },
        );
        qc.setQueryData(CHAVE, r.data.altimus);
        toast.success(
          ativa
            ? t("Estoque do Altimus ligado nesta organização.")
            : t("Estoque do Altimus desligado."),
        );
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Não consegui salvar."));
      }
    });
  }

  if (isLoading || !data) return null;
  const ligada = data.sincroniza_aqui;

  return (
    <Card className="max-w-3xl space-y-3 p-4" data-testid="altimus-da-organizacao">
      <div>
        <h2 className="text-sm font-semibold">{t("Estoque do Altimus")}</h2>
        <p className="text-xs text-muted-foreground">
          {t(
            "De hora em hora, os carros do Altimus entram e saem do catálogo de produtos desta organização (preço, km e fotos). Só uma organização pode receber o estoque.",
          )}
        </p>
      </div>
      <p className="text-sm" data-testid="altimus-estado">
        {ligada
          ? t("Ligado: esta organização recebe o estoque.")
          : t("Desligado: esta organização não recebe o estoque.")}
      </p>
      {!data.url_configurada ? (
        <p className="text-xs text-muted-foreground">
          {t(
            "O endereço do Altimus ainda não foi colado em Admin › Configuração › Integrações. Sem ele, nada sincroniza.",
          )}
        </p>
      ) : null}
      {data.outra_organizacao_ligada && !ligada ? (
        <p className="text-xs text-muted-foreground">
          {t("O estoque está ligado em outra organização. Desligue lá antes de ligar aqui.")}
        </p>
      ) : null}
      <div>
        {ligada ? (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => gravar(false)}
          >
            {t("Desligar o estoque aqui")}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={isPending || data.outra_organizacao_ligada}
            onClick={() => gravar(true)}
            data-testid="altimus-ligar"
          >
            {t("Ligar o estoque nesta organização")}
          </Button>
        )}
      </div>
    </Card>
  );
}
