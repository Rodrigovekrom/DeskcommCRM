"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { CAMPOS_EXIGIVEIS, type ItemDoPadrao, type PadraoDaLoja } from "@/lib/iavek/padrao-da-loja";

const CHAVE = ["iavek", "padrao", "config"] as const;

/**
 * ia.vek v1.8.0 (A1) — "Padrão da loja" em Configurações › Atendimento. Só o
 * admin chega aqui (a página exige admin; a rota PATCH também). Desligado por
 * padrão: ligado, o checklist aparece no atendimento, o selo no Pipeline e o
 * "Fora do padrão" no Meu dia do gerente. Sem IA.
 */
export function PadraoDaLojaConfig({ etapas }: { etapas: Array<{ id: string; name: string }> }) {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<ApiSuccess<PadraoDaLoja>>("/api/v1/iavek/padrao").then((r) => r.data),
  });
  const [rascunho, setRascunho] = useState<PadraoDaLoja | null>(null);
  const atual = rascunho ?? data ?? null;
  const salvar = useMutation({
    mutationFn: (p: PadraoDaLoja) => apiClient.patch("/api/v1/iavek/padrao", p),
    onSuccess: () => {
      setRascunho(null);
      void qc.invalidateQueries({ queryKey: ["iavek", "padrao"] });
    },
    onError: showApiError,
  });
  if (!atual) return null;
  const noLimite = atual.itens.length >= 20;
  const mudarItem = (i: number, parte: Partial<ItemDoPadrao>) =>
    setRascunho({ ...atual, itens: atual.itens.map((it, j) => (j === i ? { ...it, ...parte } : it)) });
  const rotuloDoCampo: Record<(typeof CAMPOS_EXIGIVEIS)[number], string> = {
    forma_pagamento: t("Forma de pagamento"),
    tem_troca: t("Tem carro na troca?"),
    carro_interesse: t("Carro de interesse"),
    prazo_compra: t("Prazo para comprar"),
  };

  return (
    <section className="space-y-4 rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="padrao-da-loja-config">
      <div>
        <h2 className="text-lg font-semibold">{t("Padrão da loja")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("O que todo atendimento tem de ter, e até quando. O sistema confere sozinho (sem IA) e só sinaliza: nada trava e nada é enviado ao cliente.")}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Switch
          checked={atual.ativo}
          onCheckedChange={(v) => setRascunho({ ...atual, ativo: v })}
          data-testid="padrao-ligado"
        />
        {atual.ativo ? t("Padrão ligado") : t("Padrão desligado")}
      </label>
      <ul className="space-y-3">
        {atual.itens.map((it, i) => (
          <li key={`${it.id}-${i}`} className="space-y-2 rounded-md border p-3 text-sm" data-testid="item-do-padrao-config">
            <div className="flex flex-wrap items-center gap-2">
              <input className="min-w-56 flex-1 rounded-md border px-2 py-1" value={it.nome} onChange={(e) => mudarItem(i, { nome: e.target.value })} aria-label={t("Nome do item")} />
              <select className="rounded-md border px-2 py-1" value={it.tipo} onChange={(e) => mudarItem(i, { tipo: e.target.value as ItemDoPadrao["tipo"] })} aria-label={t("Tipo do item")}>
                <option value="marcacao">{t("O vendedor marca (1 toque)")}</option>
                <option value="campo">{t("Campo do lead preenchido")}</option>
              </select>
              <button type="button" className="text-red-700 underline" onClick={() => setRascunho({ ...atual, itens: atual.itens.filter((_, j) => j !== i) })}>
                {t("Remover")}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {it.tipo === "marcacao" ? (
                <>
                  <label className="flex items-center gap-1">
                    {t("Mínimo de fotos enviadas")}
                    <input type="number" min={0} max={50} className="w-16 rounded-md border px-1" value={it.minimo_de_fotos} onChange={(e) => mudarItem(i, { minimo_de_fotos: Number(e.target.value) || 0 })} />
                  </label>
                  <label className="flex items-center gap-1">
                    {t("Mínimo de vídeos enviados")}
                    <input type="number" min={0} max={20} className="w-16 rounded-md border px-1" value={it.minimo_de_videos} onChange={(e) => mudarItem(i, { minimo_de_videos: Number(e.target.value) || 0 })} />
                  </label>
                </>
              ) : (
                <label className="flex items-center gap-1">
                  {t("Campo")}
                  <select className="rounded-md border px-1" value={it.campo ?? "forma_pagamento"} onChange={(e) => mudarItem(i, { campo: e.target.value as ItemDoPadrao["campo"] })}>
                    {CAMPOS_EXIGIVEIS.map((c) => (
                      <option key={c} value={c}>
                        {rotuloDoCampo[c]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-1">
                {t("Prazo em horas depois de assumir")}
                <input type="number" min={1} max={720} className="w-16 rounded-md border px-1" value={it.horas ?? ""} onChange={(e) => mudarItem(i, { horas: e.target.value ? Number(e.target.value) : null })} />
              </label>
              <label className="flex items-center gap-1">
                {t("ou até a etapa")}
                <select className="rounded-md border px-1" value={it.ate_etapa ?? ""} onChange={(e) => mudarItem(i, { ate_etapa: e.target.value || null })}>
                  <option value="">—</option>
                  {etapas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={noLimite}
          title={noLimite ? t("O padrão aceita até 20 itens.") : undefined}
          onClick={() =>
            setRascunho({
              ...atual,
              itens: [
                ...atual.itens,
                { id: `item_${Date.now().toString(36)}`, nome: t("Novo item"), tipo: "marcacao", minimo_de_fotos: 0, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 24 },
              ],
            })
          }
        >
          {t("+ Item")}
        </Button>
        <Button size="sm" disabled={salvar.isPending || rascunho === null} onClick={() => rascunho && salvar.mutate(rascunho)} data-testid="salvar-padrao">
          {t("Salvar padrão")}
        </Button>
      </div>
    </section>
  );
}
