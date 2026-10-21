import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";

import { ProposalEditorClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editor de Proposta" };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const { id } = await params;

  const suporteLiberaEscrita =
    !user.support || (user.support.status === "active" && user.support.access_mode === "full");
  const podeEditar = roleAtLeast(activeOrg.role, "agent") && suporteLiberaEscrita;
  // ia.vek v1.7.6: o vendedor prepara o documento da proposta do PRÓPRIO lead
  // (a rota PATCH /documento confere o dono); gerente e admin, de qualquer uma.
  const podeRevisar = roleAtLeast(activeOrg.role, "agent") && suporteLiberaEscrita;
  // Gerente e admin aprovam (enviam); o vendedor pede aprovação. Descartar é do admin.
  const aprova = roleAtLeast(activeOrg.role, "manager") && suporteLiberaEscrita;
  const podeDescartar = roleAtLeast(activeOrg.role, "admin") && suporteLiberaEscrita;

  return (
    <ProposalEditorClient
      id={id}
      podeEditar={podeEditar}
      podeRevisar={podeRevisar}
      aprova={aprova}
      podeDescartar={podeDescartar}
    />
  );
}
