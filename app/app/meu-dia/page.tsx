import type { Metadata } from "next";
import { MeuDia } from "@/components/iavek/MeuDia";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meu dia" };

/** ia.vek v1.6: a tela inicial de cada função (SDR, Vendedor, Gerente). */
export default function MeuDiaPage() {
  return <MeuDia />;
}
