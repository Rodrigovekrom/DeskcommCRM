"use client";
/**
 * ia.vek CRM-532 — o "Como foi a ligação?", montado UMA vez na casca do app (AppShell).
 *
 * Abre em dois casos:
 *   1. a pessoa tocou em "Ligar" no celular (a marca em lib/ligar/marca.ts), saiu para o discador e VOLTOU ao CRM depois
 *      de pelo menos 5 s (a aba voltou a ficar visível). A marca é apagada na volta: a pergunta aparece uma vez só;
 *   2. o "Registrar a ligação" do computador (o evento EVENTO_PERGUNTAR do BotaoLigar).
 * Antes de abrir, pergunta ao servidor (GET /api/v1/contacts/[id]/ligacao) se há onde registrar: sem negócio aberto,
 * não abre; sem tarefa de ligação aberta, depende de LIGACAO_SEM_TAREFA_REGISTRA (lib/ligar/regras.ts). O formulário
 * é o MESMO dos 3 campos da tarefa (RegistroDeLigacao). Fechar sem responder não registra nada.
 */
import { useCallback, useEffect, useState } from "react";

import { RegistroDeLigacao, type DestinoDaLigacao } from "@/app/app/tasks/_components/RegistroDeLigacao";
import { EVENTO_PERGUNTAR, type PedidoDePergunta } from "@/components/ligar/BotaoLigar";
import { useT } from "@/hooks/i18n/useT";
import { apagarMarca, lerMarca, voltouDaLigacao } from "@/lib/ligar/marca";

interface RespostaDoAlvo {
  data?: { pergunta?: boolean; lead_id?: string | null; tarefa?: { id: string; titulo: string } | null };
}

export function ComoFoiALigacao() {
  const t = useT();
  const [destino, setDestino] = useState<DestinoDaLigacao | null>(null);

  const perguntar = useCallback(
    async (contatoId: string, leadId: string | null) => {
      try {
        const q = leadId ? `?lead_id=${encodeURIComponent(leadId)}` : "";
        const r = await fetch(`/api/v1/contacts/${encodeURIComponent(contatoId)}/ligacao${q}`);
        if (!r.ok) return;
        const j = (await r.json()) as RespostaDoAlvo;
        if (j.data?.pergunta !== true) return;
        setDestino({
          contatoId,
          leadId: j.data.lead_id ?? null,
          subtitulo: j.data.tarefa?.titulo ?? t("Registre o que foi falado com o cliente."),
        });
      } catch {
        // sem rede: a pergunta não abre; o registro à mão continua possível
      }
    },
    [t],
  );

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      const m = lerMarca();
      if (!voltouDaLigacao(m, Date.now())) return;
      apagarMarca();
      void perguntar(m!.contatoId, m!.leadId);
    };
    const aoPedir = (e: Event) => {
      const d = (e as CustomEvent<PedidoDePergunta>).detail;
      if (d?.contatoId) void perguntar(d.contatoId, d.leadId ?? null);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener(EVENTO_PERGUNTAR, aoPedir);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener(EVENTO_PERGUNTAR, aoPedir);
    };
  }, [perguntar]);

  return (
    <RegistroDeLigacao
      key={destino ? `${destino.contatoId}:${destino.leadId ?? ""}` : "nenhuma"}
      tarefa={null}
      destino={destino}
      aoFechar={() => setDestino(null)}
      aoRegistrar={() => setDestino(null)}
    />
  );
}
