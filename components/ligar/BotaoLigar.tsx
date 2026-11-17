"use client";
/**
 * ia.vek CRM-532 — o botão "Ligar", na conversa, no negócio, no contato e na tarefa de ligação.
 *
 * No CELULAR (tela de toque): é um link `tel:+55…` com o número do CADASTRO do contato (nunca digitado). Tocar abre o
 * discador do próprio celular; o CRM guarda a marca "ligação começando" neste aparelho e, quando a pessoa VOLTA,
 * pergunta "Como foi a ligação?" (components/ligar/ComoFoiALigacao.tsx).
 *
 * No COMPUTADOR o `tel:` abre outro programa ou nada, e o CRM não tem como saber se a pessoa ligou. Então o botão
 * abre um quadro com o número grande, "Copiar" e "Registrar a ligação" (à mão), sem pergunta automática.
 *
 * Não aparece em grupo, sem telefone utilizável (hrefDeLigar → null), nem para quem não liga pelo CRM (a função fora da
 * lista da loja; de fábrica, só o vendedor liga: useLigaPeloCrm).
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLigaPeloCrm } from "@/components/ligar/LigarContext";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { marcarLigacao } from "@/lib/ligar/marca";
import { hrefDeLigar } from "@/lib/ligar/regras";
import { Copy, Phone } from "@/lib/ui/icons";

/** O evento que pede o "Como foi a ligação?" na hora (o "Registrar a ligação" do computador). */
export const EVENTO_PERGUNTAR = "ligar:perguntar";
export interface PedidoDePergunta {
  contatoId: string;
  leadId: string | null;
}

/** Tela de toque = celular/tablet: lá o `tel:` abre o discador. */
function ehToque(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

export function BotaoLigar({
  contatoId,
  telefone,
  leadId = null,
  tarefaId = null,
  ehGrupo = false,
  tamanho = "sm",
}: {
  contatoId: string;
  telefone: string | null | undefined;
  leadId?: string | null;
  tarefaId?: string | null;
  ehGrupo?: boolean;
  tamanho?: "sm" | "default";
}) {
  const t = useT();
  const [toque, setToque] = useState(false);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => setToque(ehToque()), []);

  const ligaAqui = useLigaPeloCrm();
  const href = ehGrupo || !ligaAqui ? null : hrefDeLigar(telefone);
  if (!href) return null;
  const numero = href.slice("tel:".length);

  if (toque) {
    return (
      <Button asChild size={tamanho} variant="outline" data-testid="botao-ligar">
        <a href={href} onClick={() => marcarLigacao({ contatoId, leadId, tarefaId })}>
          <Phone size={14} aria-hidden /> {t("Ligar para o cliente")}
        </a>
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size={tamanho} variant="outline" data-testid="botao-ligar">
          <Phone size={14} aria-hidden /> {t("Ligar para o cliente")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" data-testid="ligar-no-computador">
        <p className="text-xs text-muted-foreground">{t("Ligue do seu celular para:")}</p>
        <p className="text-xl font-semibold tracking-wide" data-testid="ligar-numero">
          {numero}
        </p>
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void copyToClipboard(numero).then((ok) => setCopiado(ok));
            }}
          >
            <Copy size={14} aria-hidden /> {copiado ? t("Copiado") : t("Copiar")}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent<PedidoDePergunta>(EVENTO_PERGUNTAR, { detail: { contatoId, leadId } }),
              )
            }
          >
            {t("Registrar a ligação")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
