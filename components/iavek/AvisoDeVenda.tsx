"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { apiClient } from "@/lib/api/client";
import { useDepoisDoQuadro } from "@/lib/iavek/vez-do-quadro";

interface Aviso {
  id: string;
  quem: string | null;
  carro: string | null;
}

const CHAVE = ["iavek", "avisos-de-venda"];
/** Acima disto, a mensagem curta: quem estava fora não abre uma lista enorme. */
export const LIMITE_DA_LISTA = 3;

/**
 * ia.vek v1.9.20 (CRM-234): "Fulano vendeu o Carro X", em pop-up na hora, em qualquer
 * tela. Quem estava fora vê ao abrir. Uma vez por pessoa: o aviso é marcado ao aparecer.
 * Sem cliente, sem valor e sem som novo. O registro continua no sino.
 */
export function AvisoDeVenda() {
  const t = useT();
  const qc = useQueryClient();
  const { user, activeOrg } = useAuth();
  const [visiveis, setVisiveis] = useState<Aviso[]>([]);
  const jaMostrados = useRef(new Set<string>());
  const ligado = Boolean(activeOrg) && !user.support;
  const depoisDoQuadro = useDepoisDoQuadro(); // v1.9.26: espera o board na tela de quadro

  const { data } = useQuery({
    queryKey: CHAVE,
    enabled: ligado && depoisDoQuadro,
    queryFn: () =>
      apiClient
        .get<{ data: { avisos: Aviso[] } }>("/api/v1/iavek/notificacoes/avisos-de-venda")
        .then((r) => r.data.avisos),
  });
  const recarregar = useCallback(() => void qc.invalidateQueries({ queryKey: CHAVE }), [qc]);
  useRealtimeChannel({
    name: `aviso-de-venda:${user.id}:${activeOrg?.orgId ?? "-"}`,
    enabled: ligado,
    postgresChanges: { event: "INSERT", table: "notificacoes", filter: `user_id=eq.${user.id}` },
    onChange: recarregar,
  });

  useEffect(() => {
    const novos = (data ?? []).filter((a) => !jaMostrados.current.has(a.id));
    if (novos.length === 0) return;
    for (const a of novos) jaMostrados.current.add(a.id);
    setVisiveis((atuais) => [...atuais, ...novos]);
    void apiClient
      .patch("/api/v1/iavek/notificacoes/avisos-de-venda", { ids: novos.map((a) => a.id) })
      .catch(() => undefined);
  }, [data]);

  if (visiveis.length === 0) return null;
  const frase = (a: Aviso) =>
    t("{who} vendeu {carro}")
      .replace("{who}", a.quem ?? t("Alguém da equipe"))
      .replace("{carro}", a.carro ?? t("um carro"));

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="aviso-de-venda"
      className="fixed left-1/2 top-16 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-border bg-surface p-4 shadow-lg"
    >
      {visiveis.length > LIMITE_DA_LISTA ? (
        <p className="text-sm font-medium" data-testid="aviso-de-venda-resumo">
          {t("{n} vendas novas na loja").replace("{n}", String(visiveis.length))}
        </p>
      ) : (
        <ul className="space-y-1 text-sm font-medium">
          {visiveis.map((a) => (
            <li key={a.id}>{frase(a)}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => setVisiveis([])} data-testid="aviso-de-venda-ok">
          {t("Ok")}
        </Button>
      </div>
    </div>
  );
}
