"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import type { TravaDaLoja } from "@/hooks/kanban/useMoveCard";

/**
 * v1.8.4: ONDE preencher cada item. Os rótulos são os da 0590 (fixos); item
 * desconhecido aparece sem dica. Literais por item: a chave de t() nunca é
 * montada em runtime (cerca i18n).
 */
function useOndePreencher(): (item: string) => string | null {
  const t = useT();
  const DICAS: Record<string, string> = {
    "Contexto completo": t("Escreva na Descrição do lead (20 letras ou mais) ou deixe uma nota interna na conversa."),
    "Tags de acompanhamento": t("Escolha uma etiqueta em Tags, na ficha do lead."),
    "Fase do funil": t("A etapa do lead no quadro."),
    "Guardião responsável": t("Vem sozinho quando o lead passa por um SDR. Peça ao gerente se faltar."),
    "Vendedor responsável": t("O dono do lead. Peça ao gerente para atribuir."),
    "Carro de interesse": t("Escolha o carro do catálogo em Carro de interesse, na ficha do lead."),
    "Parcela desejável": t("Preencha Parcela desejável (R$), na ficha do lead."),
  };
  return (item) => DICAS[item] ?? null;
}

/**
 * ia.vek v1.8.3 — a recusa da TRAVA DOS CAMPOS OBRIGATÓRIOS (0590) vira janela.
 *
 * Até a v1.8.2 ela chegava como toast vermelho com "ID: …": dizia que deu
 * errado, mas não o que fazer. Aqui a pessoa vê a lista do que falta e um botão
 * que abre a ficha do lead já nos campos. O cartão volta para onde estava (o
 * rollback do mover); depois de preencher, é só arrastar de novo.
 */
export function TravaDosCamposDialog({
  trava,
  onOpenChange,
  onPreencher,
}: {
  trava: TravaDaLoja | null;
  onOpenChange: (aberto: boolean) => void;
  onPreencher: (leadId: string) => void;
}) {
  const t = useT();
  const onde = useOndePreencher();
  return (
    <Dialog open={trava !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="trava-dos-campos">
        <DialogHeader>
          <DialogTitle>{t("Faltam campos obrigatórios")}</DialogTitle>
          <DialogDescription>
            {t("Para avançar este lead, preencha antes:")}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {(trava?.faltam ?? []).map((f) => (
            <li key={f}>
              <span className="font-medium">{f}</span>
              {onde(f) && <span className="block text-xs text-muted-foreground" data-testid="onde-preencher">{onde(f)}</span>}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Agora não")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (trava) onPreencher(trava.leadId);
            }}
          >
            {t("Preencher agora")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
