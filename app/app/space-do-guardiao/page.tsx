import type { Metadata } from "next";
import { SpaceDoGuardiao } from "@/components/iavek/SpaceDoGuardiao";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Space do guardião" };

/** ia.vek v1.9.7: os leads que o guardião passou aos vendedores, por urgência. */
export default function SpaceDoGuardiaoPage() {
  return <SpaceDoGuardiao />;
}
