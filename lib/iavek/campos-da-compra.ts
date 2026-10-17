import type { CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";

/**
 * ia.vek v1.5: os campos da FICHA DA COMPRA de veículo, prontos para um funil.
 *
 * Não são gravados por ninguém sozinhos: o administrador os acrescenta pela
 * tela do funil (botão "Acrescentar campos da compra de veículo") e salva.
 * Chave que o funil já tem não é duplicada nem sobrescrita.
 */
export const CAMPOS_DA_COMPRA_DE_VEICULO: CustomFieldDef[] = [
  { key: "carro_interesse", label: "Carro de interesse", type: "catalog_product" },
  {
    key: "forma_pagamento",
    label: "Forma de pagamento",
    type: "select",
    options: [
      { value: "a_vista", label: "À vista" },
      { value: "financiamento", label: "Financiamento" },
      { value: "consorcio", label: "Consórcio" },
    ],
  },
  { key: "entrada_reais", label: "Entrada (R$)", type: "number" },
  {
    key: "prazo_compra",
    label: "Prazo para comprar",
    type: "select",
    options: [
      { value: "0_7", label: "0 a 7 dias" },
      { value: "7_15", label: "7 a 15 dias" },
      { value: "15_30", label: "15 a 30 dias" },
      { value: "30_mais", label: "Mais de 30 dias" },
    ],
  },
  { key: "cidade", label: "Cidade / região", type: "text" },
  { key: "tem_troca", label: "Tem carro na troca?", type: "boolean" },
  { key: "troca_modelo", label: "Troca: modelo", type: "text" },
  { key: "troca_ano", label: "Troca: ano", type: "number" },
  { key: "troca_km", label: "Troca: km", type: "number" },
];

/** Acrescenta os que faltam, sem tocar nos que o funil já tem (por chave). */
export function comCamposDaCompra<T extends { key: string }>(
  atuais: T[],
  limite = 50,
): Array<T | CustomFieldDef> {
  const chaves = new Set(atuais.map((f) => f.key.toLowerCase()));
  const novos = CAMPOS_DA_COMPRA_DE_VEICULO.filter((f) => !chaves.has(f.key));
  return [...atuais, ...novos].slice(0, Math.max(limite, atuais.length));
}
