import type { Metadata } from "next";
import { MeusNumeros } from "@/components/iavek/MeusNumeros";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meus números" };

/** ia.vek v1.9.3: os números só de quem está conectado (SDR e vendedor). */
export default function MeusNumerosPage() {
  return <MeusNumeros />;
}
