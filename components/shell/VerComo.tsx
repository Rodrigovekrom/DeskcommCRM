"use client";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { FUNCOES_DE_ESCOLHA, ROTULO_DA_FUNCAO, funcaoDaTela } from "@/lib/iavek/funcoes";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Eye, X } from "@/lib/ui/icons";

/**
 * ia.vek v1.6: o seletor "Ver como" no menu do usuário (só para quem
 * administra). Troca a VISÃO na hora — menu e tela inicial — sem trocar papel
 * nem permissão; a escolha fica lembrada neste navegador.
 */
export function VerComoNoMenu() {
  const t = useT();
  const { podeVerComo, verComo, definirVerComo } = useAuth();
  if (!podeVerComo) return null;
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Eye size={14} aria-hidden />
        {t("Ver como")}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={verComo ?? "minha"}
        onValueChange={(v) => definirVerComo(funcaoDaTela(v))}
      >
        {FUNCOES_DE_ESCOLHA.map((f) => (
          <DropdownMenuRadioItem key={f} value={f} data-testid={`ver-como-${f}`}>
            {t(ROTULO_DA_FUNCAO[f])}
          </DropdownMenuRadioItem>
        ))}
        <DropdownMenuRadioItem value="minha" data-testid="ver-como-minha">
          {t("Minha visão")}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  );
}

/** O selo discreto "Vendo como: SDR", com o botão de voltar à própria visão. */
export function SeloVerComo() {
  const t = useT();
  const { verComo, definirVerComo } = useAuth();
  if (!verComo) return null;
  return (
    <span
      data-testid="selo-ver-como"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-0.5 pr-0.5 pl-2 text-xs font-medium text-text"
    >
      <Eye size={12} aria-hidden />
      {t("Vendo como: {role}").replace("{role}", t(ROTULO_DA_FUNCAO[verComo]))}
      <button
        type="button"
        aria-label={t("Voltar para a minha visão")}
        title={t("Voltar para a minha visão")}
        onClick={() => definirVerComo(null)}
        className="flex size-5 items-center justify-center rounded-full hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <X size={11} aria-hidden />
      </button>
    </span>
  );
}
