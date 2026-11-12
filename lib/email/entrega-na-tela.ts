/**
 * ia.vek v1.9.47 (0627): como a tela de Equipe diz a ENTREGA do convite. Sem dependência de servidor (o client
 * importa). `null` = ainda sem notícia da Resend (ou o envio saiu pelo SMTP): a tela segue dizendo só "Sim".
 */
export type EstadoDaEntregaNaTela = "enviado" | "atrasado" | "entregue" | "voltou" | "spam" | "falhou";

export interface EntregaDoConvite {
  estado: EstadoDaEntregaNaTela;
  detalhe: string | null;
}

/** O texto (fonte pt-BR, traduzido pela tela) e se é um problema (mostra em vermelho, com o "Copiar link"). */
export function rotuloDaEntrega(e: EntregaDoConvite | null | undefined): { texto: string; problema: boolean } {
  switch (e?.estado) {
    case "entregue":
      return { texto: "Entregue", problema: false };
    case "atrasado":
      return { texto: "Entrega atrasada", problema: false };
    case "voltou":
      return { texto: "Voltou (endereço não recebe)", problema: true };
    case "spam":
      return { texto: "Marcado como spam", problema: true };
    case "falhou":
      return { texto: "Não foi entregue", problema: true };
    default:
      return { texto: "Sim", problema: false };
  }
}
