"use client";
import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * ia.vek v1.9.16: link de menu que só pré-carrega a página quando o mouse ou o
 * foco chega nele.
 *
 * O `Link` padrão pré-carrega tudo o que está visível. Com um menu inteiro à
 * vista, cada abertura de tela disparava de 8 a 42 pedidos ao servidor, e cada um
 * valida a sessão. Medido no canário (gerente, Atendimento): de 2,5 s para 0,6 s
 * até a tela ficar útil sem eles. Passar o mouse mantém a troca de tela rápida.
 */
export function LinkDoMenu({ onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [ativo, setAtivo] = useState(false);
  return (
    <Link
      {...props}
      prefetch={ativo ? null : false}
      onMouseEnter={(e) => {
        setAtivo(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setAtivo(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setAtivo(true);
        onTouchStart?.(e);
      }}
    />
  );
}
