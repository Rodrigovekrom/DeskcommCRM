"use client";

import { useCatalogoDoCampo } from "@/components/contacts/CampoDoCatalogo";
import { useT } from "@/hooks/i18n/useT";
import { carroIndisponivel } from "@/lib/iavek/carro-do-lead";

/**
 * ia.vek v1.9.12 — o selo do lead aberto cujo carro saiu do estoque. No cartão, na
 * ficha e na barra da conversa. Quem tem lead naquele carro chega a ele por aqui;
 * o aviso a toda a loja só diz qual é o carro.
 */
export function SeloCarroIndisponivel({ valor, status }: { valor: unknown; status: string | null | undefined }) {
  const t = useT();
  const { data: produtos } = useCatalogoDoCampo(typeof valor === "string" && valor.trim() !== "" && status === "open");
  if (!carroIndisponivel(valor, status, produtos)) return null;
  return (
    <span
      className="inline-block self-start rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
      data-testid="selo-carro-indisponivel"
    >
      {t("Carro indisponível")}
    </span>
  );
}
