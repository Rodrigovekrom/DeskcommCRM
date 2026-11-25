import type { Metadata } from "next";
import { ManualDaLoja } from "@/components/iavek/OrientacoesDaLoja";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Manual da loja" };

/**
 * ia.vek CRM-439 fase 1 (0651): o Manual da loja — as orientações e novidades que valem hoje para a pessoa; para o
 * gestor, também o envio e quem leu. Não entra no menu de nenhuma função (o menu é decisão do Rodrigo): chega-se aqui
 * pelo bloco "Orientações para você" do Meu dia e pelo sino. Quem abre cada linha é a RLS da 0651.
 */
export default function ManualDaLojaPage() {
  return <ManualDaLoja />;
}
