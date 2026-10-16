"use client";

/**
 * Grupo de avisos da equipe (ia.vek D4): para onde vão os avisos das
 * automações "Avisar grupo do WhatsApp da equipe" — 🎉 comemoração, 🚨 urgente,
 * 📊 observação. Um grupo só, escolhido entre os grupos conhecidos dos números.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";

export interface GrupoConhecido {
  channel_session_id: string;
  group_chat_id: string;
  rotulo: string;
}

export interface AvisoGrupoInicial {
  grupo: string; // `${channel_session_id}|${group_chat_id}` ou ""
  espacamento_segundos: number;
  teto_diario: number;
}

export function AvisoGrupoForm({
  initial,
  grupos,
  podeSalvar,
}: {
  initial: AvisoGrupoInicial;
  grupos: GrupoConhecido[];
  podeSalvar: boolean;
}) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const [salvo, setSalvo] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const sujo = JSON.stringify(form) !== JSON.stringify(salvo);
  const desabilitado = isPending || !podeSalvar;

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (form.grupo === "") {
          await apiClient.patch("/api/v1/settings/aviso-grupo", null);
        } else {
          const [channel_session_id, group_chat_id] = form.grupo.split("|");
          await apiClient.patch("/api/v1/settings/aviso-grupo", {
            channel_session_id,
            group_chat_id,
            espacamento_segundos: form.espacamento_segundos,
            teto_diario: form.teto_diario,
          });
        }
        setSalvo(form);
        toast.success(t("Grupo de avisos salvo."));
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Não consegui salvar."));
      }
    });
  }

  return (
    <form onSubmit={salvar} className="flex max-w-3xl flex-col gap-4" data-testid="form-aviso-grupo">
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("Grupo de avisos da equipe")}</h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "As automações com a ação \"Avisar grupo do WhatsApp da equipe\" mandam aqui: 🎉 comemoração, 🚨 urgente e 📊 observação. Nunca vai para cliente. O espaçamento e o teto do dia protegem o número.",
            )}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="aviso-grupo">{t("Grupo")}</Label>
          <select
            id="aviso-grupo"
            data-testid="aviso-grupo"
            className="h-9 w-full max-w-sm rounded-md border bg-background px-2 text-sm"
            value={form.grupo}
            disabled={desabilitado}
            onChange={(e) => setForm((f) => ({ ...f, grupo: e.target.value }))}
          >
            <option value="">{t("Desligado")}</option>
            {grupos.map((g) => (
              <option key={`${g.channel_session_id}|${g.group_chat_id}`} value={`${g.channel_session_id}|${g.group_chat_id}`}>
                {g.rotulo}
              </option>
            ))}
          </select>
          {grupos.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("Nenhum grupo conhecido ainda. Liste os grupos do número em Conexões › Grupos.")}
            </p>
          ) : null}
        </div>
        <div className="grid max-w-sm grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="aviso-espacamento">{t("Espaço entre avisos (segundos)")}</Label>
            <Input
              id="aviso-espacamento"
              type="number"
              min={10}
              max={3600}
              value={form.espacamento_segundos}
              disabled={desabilitado}
              onChange={(e) => setForm((f) => ({ ...f, espacamento_segundos: Number(e.target.value) || 60 }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aviso-teto">{t("Máximo de avisos por dia")}</Label>
            <Input
              id="aviso-teto"
              type="number"
              min={1}
              max={200}
              value={form.teto_diario}
              disabled={desabilitado}
              onChange={(e) => setForm((f) => ({ ...f, teto_diario: Number(e.target.value) || 30 }))}
            />
          </div>
        </div>
        {!podeSalvar ? (
          <p className="text-xs text-muted-foreground">{t("Só administradores mudam esta configuração.")}</p>
        ) : null}
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={desabilitado || !sujo}>
          {isPending ? t("Salvando…") : t("Salvar grupo de avisos")}
        </Button>
        {sujo ? <span className="text-xs text-muted-foreground">{t("Há mudanças não salvas.")}</span> : null}
      </div>
    </form>
  );
}
