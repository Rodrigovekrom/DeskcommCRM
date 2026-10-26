"use client";

import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";

export interface CampoDaFichaNaTela {
  key: string;
  label: string;
  tipo: "texto" | "cpf" | "data" | "dinheiro" | "numero";
  obrigatorio: boolean;
}
interface FichaDaLista {
  id: string;
  status: "enviada" | "pendente_documento" | "aprovada" | "recusada";
  motivo: string | null;
  enviada_por_nome: string | null;
  created_at: string;
}

const chaveDasFichas = (leadId: string) => ["iavek", "fichas", leadId] as const;

/** O rótulo de cada status, em literais (a chave de t() nunca é montada). */
export function useRotuloDoStatusDaFicha() {
  const t = useT();
  return {
    enviada: t("Em análise"),
    pendente_documento: t("Pendente de documento"),
    aprovada: t("Aprovada"),
    recusada: t("Recusada"),
  } as const;
}

/**
 * ia.vek v1.7.8 — "Passar ficha" do lead.
 *
 * O vendedor DONO do lead (ou o admin) envia a ficha de crédito com os campos
 * que o admin definiu e anexa os documentos; a analista decide. Quem só
 * acompanha (o gerente) vê o STATUS, nunca os dados — a rota não os devolve.
 */
/** v1.9.0: a ficha de crédito é da loja de carros; nos outros perfis, nada aparece. */
export function PassarFicha(props: { leadId: string; donoDoLead: string | null }) {
  const { lojaDeCarros } = usePerfilDaEmpresa();
  return lojaDeCarros ? <PassarFichaDaLoja {...props} /> : null;
}

function PassarFichaDaLoja({ leadId, donoDoLead }: { leadId: string; donoDoLead: string | null }) {
  const t = useT();
  const rotulo = useRotuloDoStatusDaFicha();
  const { user, activeOrg } = useAuth();
  const ehAdmin = activeOrg?.role === "admin";
  const podeEnviar = (ehAdmin || (donoDoLead !== null && donoDoLead === user.id)) && activeOrg?.role !== "viewer";
  const [aberta, setAberta] = useState<null | { modo: "nova" } | { modo: "corrigir" | "documentos"; fichaId: string }>(null);

  const { data: fichas } = useQuery({
    queryKey: chaveDasFichas(leadId),
    queryFn: () =>
      apiClient.get<ApiSuccess<FichaDaLista[]>>(`/api/v1/iavek/fichas?lead_id=${leadId}`).then((r) => r.data),
  });

  return (
    <div className="space-y-2" data-testid="passar-ficha">
      {(Array.isArray(fichas) ? fichas : []).map((f) => (
        <div key={f.id} className="rounded-md border p-2 text-xs" data-testid="ficha-do-lead">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium" data-testid="status-da-ficha">
              {t("Ficha")}: {rotulo[f.status]}
            </span>
            <span className="text-text-muted">{new Date(f.created_at).toLocaleDateString()}</span>
          </div>
          {f.motivo && <p className="mt-1 text-text-muted">{f.motivo}</p>}
          {podeEnviar && (f.status === "enviada" || f.status === "pendente_documento") && (
            <div className="mt-1 flex gap-2">
              <button type="button" className="underline" onClick={() => setAberta({ modo: "documentos", fichaId: f.id })}>
                {t("Anexar documento")}
              </button>
              {f.status === "pendente_documento" && (
                <button type="button" className="underline" onClick={() => setAberta({ modo: "corrigir", fichaId: f.id })}>
                  {t("Corrigir e reenviar")}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {podeEnviar && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAberta({ modo: "nova" })} data-testid="abrir-passar-ficha">
          {t("Passar ficha")}
        </Button>
      )}
      <Dialog open={aberta !== null} onOpenChange={(v) => !v && setAberta(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {aberta?.modo === "documentos" ? t("Documentos da ficha") : aberta?.modo === "corrigir" ? t("Corrigir a ficha") : t("Passar ficha")}
            </DialogTitle>
          </DialogHeader>
          {aberta?.modo === "documentos" ? (
            <AnexarDocumentos fichaId={aberta.fichaId} />
          ) : aberta ? (
            <FormularioDaFicha
              leadId={leadId}
              fichaId={aberta.modo === "corrigir" ? aberta.fichaId : null}
              aoTerminar={(id) => setAberta(id ? { modo: "documentos", fichaId: id } : null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormularioDaFicha({
  leadId,
  fichaId,
  aoTerminar,
}: {
  leadId: string;
  fichaId: string | null;
  aoTerminar: (fichaCriada: string | null) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: campos } = useQuery({
    queryKey: ["iavek", "fichas", "campos"],
    queryFn: () => apiClient.get<ApiSuccess<{ campos: CampoDaFichaNaTela[] }>>("/api/v1/iavek/fichas/campos").then((r) => r.data.campos),
  });
  // Na correção, os campos e valores são os da própria ficha.
  const { data: atual } = useQuery({
    queryKey: ["iavek", "ficha", fichaId],
    enabled: fichaId !== null,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ campos: CampoDaFichaNaTela[]; dados: Record<string, string>; motivo: string | null }>>(`/api/v1/iavek/fichas/${fichaId}`)
        .then((r) => r.data),
  });
  const lista = (fichaId ? atual?.campos : campos) ?? [];
  const [valores, setValores] = useState<Record<string, string>>({});
  const [problemas, setProblemas] = useState<string[]>([]);
  const valor = (k: string) => valores[k] ?? atual?.dados?.[k] ?? "";

  const enviar = useMutation({
    mutationFn: () => {
      const dados = Object.fromEntries(lista.map((c) => [c.key, valor(c.key)]));
      return fichaId
        ? apiClient.patch<ApiSuccess<{ id: string }>>(`/api/v1/iavek/fichas/${fichaId}`, { dados })
        : apiClient.post<ApiSuccess<{ id: string }>>("/api/v1/iavek/fichas", { lead_id: leadId, dados });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: chaveDasFichas(leadId) });
      aoTerminar(fichaId ? null : r.data.id);
    },
    onError: (erro) => {
      const lista = (erro as { details?: { problemas?: string[] } }).details?.problemas;
      if (Array.isArray(lista)) setProblemas(lista);
      else showApiError(erro);
    },
  });

  if (lista.length === 0) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setProblemas([]);
        enviar.mutate();
      }}
      data-testid="formulario-da-ficha"
    >
      {atual?.motivo && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">{atual.motivo}</p>}
      {lista.map((c) => (
        <label key={c.key} className="block space-y-1 text-sm">
          <span className="font-medium">
            {c.label}
            {c.obrigatorio ? " *" : ""}
          </span>
          <Input
            type={c.tipo === "data" ? "date" : "text"}
            inputMode={c.tipo === "cpf" || c.tipo === "dinheiro" || c.tipo === "numero" ? "numeric" : undefined}
            autoComplete="off"
            value={valor(c.key)}
            onChange={(e) => setValores((v) => ({ ...v, [c.key]: e.target.value }))}
            data-campo={c.key}
          />
        </label>
      ))}
      {problemas.length > 0 && (
        <ul role="alert" className="list-disc rounded-md bg-red-50 p-2 pl-6 text-sm text-red-900">
          {problemas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {t("Os dados da ficha só são vistos por você, pela analista de crédito e pelo administrador. Não vão para a IA nem para a proposta.")}
      </p>
      <Button type="submit" disabled={enviar.isPending} data-testid="enviar-ficha">
        {fichaId ? t("Reenviar para análise") : t("Enviar para análise")}
      </Button>
    </form>
  );
}

function AnexarDocumentos({ fichaId }: { fichaId: string }) {
  const t = useT();
  const [tipo, setTipo] = useState("rg");
  const [enviados, setEnviados] = useState<string[]>([]);
  const anexar = useMutation({
    mutationFn: (arquivo: File) => {
      const form = new FormData();
      form.set("arquivo", arquivo);
      form.set("tipo", tipo);
      return fetch(`/api/v1/iavek/fichas/${fichaId}/documentos`, { method: "POST", body: form }).then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error?.message ?? t("Não consegui guardar o documento."));
        return arquivo.name;
      });
    },
    onSuccess: (nome) => setEnviados((l) => [...l, nome]),
    onError: (erro) => showApiError(erro),
  });
  return (
    <div className="space-y-3 text-sm" data-testid="anexar-documentos">
      <p className="text-muted-foreground">{t("Foto ou PDF de até 10 MB. Fica guardado em área privada.")}</p>
      <select className="rounded-md border px-2 py-1" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label={t("Tipo do documento")}>
        <option value="rg">{t("RG")}</option>
        <option value="cnh">{t("CNH")}</option>
        <option value="comprovante_renda">{t("Comprovante de renda")}</option>
        <option value="comprovante_residencia">{t("Comprovante de residência")}</option>
        <option value="outro">{t("Outro")}</option>
      </select>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        disabled={anexar.isPending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) anexar.mutate(f);
          e.target.value = "";
        }}
        aria-label={t("Escolher arquivo")}
        data-testid="arquivo-da-ficha"
      />
      {enviados.length > 0 && (
        <ul className="list-disc pl-5" data-testid="documentos-enviados">
          {enviados.map((n, i) => (
            <li key={`${n}-${i}`}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
