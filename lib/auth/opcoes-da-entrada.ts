import type { EstadoDoProvedorGoogle } from "@/lib/auth/provedor-google";
import type { ModoDeCadastro } from "@/lib/auth/politica-de-cadastro";

/**
 * O que a tela de login oferece ALÉM de e-mail e senha.
 *
 * - "Criar conta" só quando a instalação aceita cadastro: em `so_convite` o link
 *   levava a um formulário que termina em recusa ("aceita cadastro apenas por
 *   convite"), depois de a pessoa já ter confirmado o e-mail.
 * - "Entrar com Google" só quando o provedor está LIGADO nas settings do
 *   Supabase. `desconhecido` (não deu para ler) também esconde: na tela de
 *   entrar, um botão que pode levar a erro é pior que a falta dele — e-mail e
 *   senha continuam ali. (A `signInWithGoogle` segue tratando `desconhecido`
 *   como tentável; é outra pergunta: lá alguém já clicou.)
 */
export function opcoesDaEntrada(entrada: {
  modo: ModoDeCadastro;
  google: EstadoDoProvedorGoogle;
}): { mostrarCadastro: boolean; mostrarGoogle: boolean } {
  return {
    mostrarCadastro: entrada.modo !== "so_convite",
    mostrarGoogle: entrada.google === "ligado",
  };
}
