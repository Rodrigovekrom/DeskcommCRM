"use client";

/**
 * ia.vek v1.9.45 (CRM-280): CEP e número do cliente no "Ir até o cliente". Com o CEP completo, a tela
 * pede a PRÉVIA (/api/v1/iavek/km): o endereço por extenso (ViaCEP) e o km de carro da loja até lá. O km
 * que fica gravado é recalculado pelo servidor na marcação; aqui é só para o vendedor ver antes.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId } from "react";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Previa = { endereco: string | null; km: number | null; motivo: string; atribuicao: string | null };

export function CepEKmDoCliente({
  cep,
  numero,
  onCep,
  onNumero,
  onEnderecoDoCep,
}: {
  cep: string;
  numero: string;
  onCep: (v: string) => void;
  onNumero: (v: string) => void;
  /** Chamado quando o CEP resolve um endereço por extenso (quem decide se usa é a marcação). */
  onEnderecoDoCep: (endereco: string) => void;
}) {
  const t = useT();
  const idCep = useId();
  const idNumero = useId();
  const digitos = cep.replace(/\D/g, "");
  const completo = digitos.length === 8;
  const previa = useQuery({
    queryKey: ["iavek", "km", digitos, numero.trim()],
    enabled: completo,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      (
        await apiClient.get<{ data: Previa }>(
          `/api/v1/iavek/km?${new URLSearchParams({ cep: digitos, numero: numero.trim() })}`,
        )
      ).data,
  });
  const endereco = previa.data?.endereco ?? null;
  useEffect(() => {
    if (endereco) onEnderecoDoCep(endereco);
    // só quando o endereço resolvido muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endereco]);

  const km = previa.data?.km ?? null;
  return (
    <div className="grid grid-cols-[1fr_6rem] gap-2" data-testid="cep-e-km-do-cliente">
      <div>
        <label htmlFor={idCep} className="text-xs font-medium text-text-secondary">
          {t("CEP do cliente")}
        </label>
        <input
          id={idCep}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          maxLength={9}
          value={cep}
          onChange={(e) => onCep(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor={idNumero} className="text-xs font-medium text-text-secondary">
          {t("Nº")}
        </label>
        <input
          id={idNumero}
          maxLength={20}
          value={numero}
          onChange={(e) => onNumero(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
      </div>
      {completo ? (
        <p className="col-span-2 text-xs text-text-muted" aria-live="polite" data-testid="km-do-cliente">
          {previa.isLoading
            ? t("Calculando o km…")
            : km !== null
              ? `≈ ${km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${t("km da loja")}`
              : previa.data?.motivo === "cep_nao_encontrado" || previa.data?.motivo === "cep_invalido"
                ? t("CEP não encontrado.")
                : t("Km indisponível agora; o agendamento segue normal.")}
          {km !== null && previa.data?.atribuicao ? (
            <span className="ml-1 opacity-70">({previa.data.atribuicao})</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
