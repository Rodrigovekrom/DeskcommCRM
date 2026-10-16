"use client";

/**
 * Esteira de vendas (ia.vek D3): QUEM recebe a cobrança de ligação atrasada e o
 * relatório semanal — por PAPEL ou por USUÁRIO, nunca nome fixo no código —, os
 * prazos da cobrança e o liga/desliga. Os funis da esteira aparecem aqui só
 * para leitura (são declarados na configuração da organização).
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";

type Destinatario = { tipo: "papel"; papel: "agent" | "manager" | "admin" } | { tipo: "usuario"; usuario_id: string };

export interface EsteiraFormInicial {
  salvo: Record<string, unknown>;
  emVigor: {
    escalada: Destinatario;
    escaladaNivel2: Destinatario;
    relatorioSemanal: Destinatario;
    escaladaHoras: number;
    escaladaHorasNivel2: number;
  };
  funis: { entrada: string; followup: string } | null;
  membros: Array<{ id: string; nome: string }>;
  podeSalvar: boolean;
}

const PAPEIS = [
  { valor: "papel:agent", rotulo: "Atendentes (e acima)" },
  { valor: "papel:manager", rotulo: "Gestores (e acima)" },
  { valor: "papel:admin", rotulo: "Administradores" },
];

const paraValor = (d: Destinatario) => (d.tipo === "papel" ? `papel:${d.papel}` : `usuario:${d.usuario_id}`);
function deValor(v: string): Destinatario {
  const [tipo, id] = v.split(":") as [string, string];
  return tipo === "papel" ? { tipo: "papel", papel: id as "agent" | "manager" | "admin" } : { tipo: "usuario", usuario_id: id };
}

export function EsteiraForm({ initial }: { initial: EsteiraFormInicial }) {
  const t = useT();
  const inicial = {
    ativa: initial.salvo.ativa === true,
    escalada: paraValor(initial.emVigor.escalada),
    escalada_nivel2: paraValor(initial.emVigor.escaladaNivel2),
    relatorio_semanal: paraValor(initial.emVigor.relatorioSemanal),
    escalada_horas: initial.emVigor.escaladaHoras,
    escalada_horas_nivel2: initial.emVigor.escaladaHorasNivel2,
  };
  const [form, setForm] = useState(inicial);
  const [salvo, setSalvo] = useState(inicial);
  const [isPending, startTransition] = useTransition();
  const sujo = JSON.stringify(form) !== JSON.stringify(salvo);
  const desabilitado = isPending || !initial.podeSalvar;

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        // O PATCH grava o bloco inteiro: o que esta tela não edita (funis, horário) vai como estava.
        await apiClient.patch("/api/v1/settings/esteira", {
          ...initial.salvo,
          ativa: form.ativa,
          escalada: deValor(form.escalada),
          escalada_nivel2: deValor(form.escalada_nivel2),
          relatorio_semanal: deValor(form.relatorio_semanal),
          escalada_horas: form.escalada_horas,
          escalada_horas_nivel2: form.escalada_horas_nivel2,
        });
        setSalvo(form);
        toast.success(t("Esteira salva."));
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Não consegui salvar."));
      }
    });
  }

  const seletor = (id: string, chave: "escalada" | "escalada_nivel2" | "relatorio_semanal", rotulo: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <select
        id={id}
        data-testid={id}
        className="h-9 w-full max-w-sm rounded-md border bg-background px-2 text-sm"
        value={form[chave]}
        disabled={desabilitado}
        onChange={(e) => setForm((f) => ({ ...f, [chave]: e.target.value }))}
      >
        <optgroup label={t("Por papel")}>
          {PAPEIS.map((p) => (
            <option key={p.valor} value={p.valor}>
              {t(p.rotulo)}
            </option>
          ))}
        </optgroup>
        {initial.membros.length > 0 ? (
          <optgroup label={t("Uma pessoa")}>
            {initial.membros.map((m) => (
              <option key={m.id} value={`usuario:${m.id}`}>
                {m.nome}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </div>
  );

  return (
    <form onSubmit={salvar} className="flex max-w-3xl flex-col gap-4" data-testid="form-esteira">
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("Esteira de vendas: ligações e cobrança")}</h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "Depois das 72 horas sem compromisso, o negócio passa sozinho para o follow-up e a equipe recebe as ligações do roteiro. Ligação atrasada é cobrada de quem você escolher abaixo, por papel ou por pessoa.",
            )}
          </p>
        </div>
        {initial.funis ? (
          <p className="text-xs" data-testid="esteira-funis">
            {t("Funis")}: <strong>{initial.funis.entrada}</strong> → <strong>{initial.funis.followup}</strong>
          </p>
        ) : (
          <p className="text-xs text-amber-600">{t("Os funis da esteira ainda não foram declarados; ela fica desligada.")}</p>
        )}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            data-testid="esteira-ativa"
            checked={form.ativa}
            disabled={desabilitado || !initial.funis}
            onChange={(e) => setForm((f) => ({ ...f, ativa: e.target.checked }))}
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
          />
          <span className="text-sm font-medium">{t("Esteira ligada")}</span>
        </label>
        {seletor("esteira-escalada", "escalada", t("Quem recebe a cobrança de ligação atrasada"))}
        <div className="max-w-sm space-y-1">
          <Label htmlFor="esteira-horas">{t("Cobrar depois de quantas horas úteis de atraso")}</Label>
          <Input
            id="esteira-horas"
            type="number"
            min={1}
            max={24}
            value={form.escalada_horas}
            disabled={desabilitado}
            onChange={(e) => setForm((f) => ({ ...f, escalada_horas: Number(e.target.value) || 1 }))}
          />
        </div>
        {seletor("esteira-escalada-2", "escalada_nivel2", t("Segundo nível (atraso maior)"))}
        <div className="max-w-sm space-y-1">
          <Label htmlFor="esteira-horas-2">{t("Segundo nível depois de quantas horas úteis")}</Label>
          <Input
            id="esteira-horas-2"
            type="number"
            min={1}
            max={72}
            value={form.escalada_horas_nivel2}
            disabled={desabilitado}
            onChange={(e) => setForm((f) => ({ ...f, escalada_horas_nivel2: Number(e.target.value) || 1 }))}
          />
        </div>
        {seletor("esteira-relatorio", "relatorio_semanal", t("Quem recebe o relatório semanal por vendedor"))}
        {!initial.podeSalvar ? (
          <p className="text-xs text-muted-foreground">{t("Só administradores mudam esta configuração.")}</p>
        ) : null}
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={desabilitado || !sujo}>
          {isPending ? t("Salvando…") : t("Salvar esteira")}
        </Button>
        {sujo ? <span className="text-xs text-muted-foreground">{t("Há mudanças não salvas.")}</span> : null}
      </div>
    </form>
  );
}
