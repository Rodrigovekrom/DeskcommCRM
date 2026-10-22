"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { useRotuloDoStatusDaFicha, type CampoDaFichaNaTela } from "./PassarFicha";

interface FichaDaFila {
  id: string;
  cliente: string | null;
  titulo_do_lead: string | null;
  status: "enviada" | "pendente_documento" | "aprovada" | "recusada";
  motivo: string | null;
  enviada_por_nome: string | null;
  created_at: string;
}
interface FichaAberta {
  id: string;
  status: FichaDaFila["status"];
  motivo: string | null;
  campos: CampoDaFichaNaTela[];
  dados: Record<string, string>;
  anonimizada: boolean;
  documentos: Array<{ id: string; tipo: string; nome: string | null }>;
  pode_decidir: boolean;
}

/**
 * A área está fora do /app (sem o cliente de API de lá): chamadas com `fetch`
 * direto, e o erro volta como frase para a tela.
 */
async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  return j.data as T;
}

/** ia.vek v1.7.8 — a fila de fichas de quem analisa (e do admin). */
export function FilaDeFichas({ admin }: { admin: boolean }) {
  const t = useT();
  const rotulo = useRotuloDoStatusDaFicha();
  const [filtro, setFiltro] = useState<string>("enviada");
  const [aberta, setAberta] = useState<string | null>(null);
  const { data: fichas, error } = useQuery({
    queryKey: ["fichas", filtro],
    queryFn: () => chamar<FichaDaFila[]>(`/api/v1/iavek/fichas${filtro ? `?status=${filtro}` : ""}`),
    refetchInterval: 30_000,
  });

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" data-testid="fila-de-fichas">
      <section className="space-y-2">
        <div className="flex flex-wrap gap-1 text-sm">
          {[
            ["enviada", t("Em análise")],
            ["pendente_documento", t("Pendente de documento")],
            ["aprovada", t("Aprovada")],
            ["recusada", t("Recusada")],
            ["", t("Todas")],
          ].map(([v, r]) => (
            <button
              key={v || "todas"}
              type="button"
              onClick={() => setFiltro(v!)}
              className={`rounded-full border px-3 py-1 ${filtro === v ? "bg-accent text-accent-foreground" : ""}`}
            >
              {r}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        <ul className="divide-y rounded-md border">
          {(fichas ?? []).map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setAberta(f.id)}
                className={`w-full p-3 text-left text-sm hover:bg-muted/50 ${aberta === f.id ? "bg-muted" : ""}`}
                data-testid="ficha-na-fila"
              >
                <span className="block font-medium">{f.cliente ?? f.titulo_do_lead ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {rotulo[f.status]} · {f.enviada_por_nome ?? "—"} · {new Date(f.created_at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
          {(fichas ?? []).length === 0 && <li className="p-3 text-sm text-muted-foreground">{t("Nenhuma ficha aqui.")}</li>}
        </ul>
        {admin && <CamposDaFicha />}
      </section>
      <section>{aberta ? <DetalheDaFicha key={aberta} id={aberta} /> : <p className="text-sm text-muted-foreground">{t("Escolha uma ficha.")}</p>}</section>
    </div>
  );
}

function DetalheDaFicha({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const rotulo = useRotuloDoStatusDaFicha();
  const { data: f, error } = useQuery({ queryKey: ["ficha", id], queryFn: () => chamar<FichaAberta>(`/api/v1/iavek/fichas/${id}`) });
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const decidir = useMutation({
    mutationFn: (status: "aprovada" | "recusada" | "pendente_documento") =>
      chamar(`/api/v1/iavek/fichas/${id}/decidir`, { method: "POST", body: JSON.stringify({ status, motivo: motivo || undefined }) }),
    onSuccess: () => {
      setErro(null);
      void qc.invalidateQueries({ queryKey: ["fichas"] });
      void qc.invalidateQueries({ queryKey: ["ficha", id] });
    },
    onError: (e) => setErro((e as Error).message),
  });
  const verDocumento = async (docId: string) => {
    try {
      const r = await chamar<{ url: string }>(`/api/v1/iavek/fichas/${id}/documentos/${docId}`);
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>;
  if (!f) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="detalhe-da-ficha">
      <p className="text-sm">
        <strong>{t("Situação")}:</strong> <span data-testid="situacao-da-ficha">{rotulo[f.status]}</span>
      </p>
      {f.motivo && <p className="rounded-md bg-muted p-2 text-sm">{f.motivo}</p>}
      {f.anonimizada ? (
        <p className="text-sm text-muted-foreground">{t("Os dados desta ficha foram apagados a pedido do titular (LGPD).")}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {f.campos.map((c) => (
            <div key={c.key} className="contents">
              <dt className="text-muted-foreground">{c.label}</dt>
              <dd data-campo={c.key}>{f.dados[c.key] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="space-y-1 text-sm">
        <p className="font-medium">{t("Documentos")}</p>
        {f.documentos.length === 0 && <p className="text-muted-foreground">{t("Nenhum documento anexado.")}</p>}
        {f.documentos.map((d) => (
          <button key={d.id} type="button" className="mr-3 underline" onClick={() => void verDocumento(d.id)} data-testid="ver-documento">
            {d.nome ?? d.tipo}
          </button>
        ))}
      </div>
      {f.pode_decidir && !f.anonimizada && (
        <div className="space-y-2 border-t pt-3">
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t("Motivo (obrigatório para recusar ou pedir documento)")}
            aria-label={t("Motivo")}
            rows={3}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={decidir.isPending} onClick={() => decidir.mutate("aprovada")} data-testid="aprovar-ficha">
              {t("Aprovar")}
            </Button>
            <Button size="sm" variant="outline" disabled={decidir.isPending} onClick={() => decidir.mutate("pendente_documento")} data-testid="pedir-documento">
              {t("Pedir documento")}
            </Button>
            <Button size="sm" variant="outline" disabled={decidir.isPending} onClick={() => decidir.mutate("recusada")} data-testid="recusar-ficha">
              {t("Recusar")}
            </Button>
          </div>
          {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
        </div>
      )}
    </div>
  );
}

/** Só o admin: os campos da ficha (nome, tipo, obrigatório). */
function CamposDaFicha() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["fichas", "campos"],
    queryFn: () => chamar<{ campos: CampoDaFichaNaTela[] }>("/api/v1/iavek/fichas/campos").then((r) => r.campos),
  });
  const [rascunho, setRascunho] = useState<CampoDaFichaNaTela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const campos = rascunho ?? data ?? [];
  const salvar = useMutation({
    mutationFn: () => chamar("/api/v1/iavek/fichas/campos", { method: "PATCH", body: JSON.stringify({ campos }) }),
    onSuccess: () => {
      setRascunho(null);
      setErro(null);
      void qc.invalidateQueries({ queryKey: ["fichas", "campos"] });
    },
    onError: (e) => setErro((e as Error).message),
  });
  const mudar = (i: number, parte: Partial<CampoDaFichaNaTela>) =>
    setRascunho(campos.map((c, j) => (j === i ? { ...c, ...parte } : c)));

  return (
    <details className="rounded-md border p-3 text-sm" data-testid="campos-da-ficha">
      <summary className="cursor-pointer font-medium">{t("Campos da ficha (admin)")}</summary>
      <div className="mt-2 space-y-2">
        {campos.map((c, i) => (
          <div key={`${c.key}-${i}`} className="flex flex-wrap items-center gap-2">
            <input className="w-40 rounded-md border px-2 py-1" value={c.label} onChange={(e) => mudar(i, { label: e.target.value })} aria-label={t("Nome do campo")} />
            <select className="rounded-md border px-1 py-1" value={c.tipo} onChange={(e) => mudar(i, { tipo: e.target.value as CampoDaFichaNaTela["tipo"] })} aria-label={t("Tipo do campo")}>
              <option value="texto">{t("Texto")}</option>
              <option value="cpf">{t("CPF")}</option>
              <option value="data">{t("Data")}</option>
              <option value="dinheiro">{t("Dinheiro")}</option>
              <option value="numero">{t("Número")}</option>
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={c.obrigatorio} onChange={(e) => mudar(i, { obrigatorio: e.target.checked })} />
              {t("Obrigatório")}
            </label>
            <button type="button" className="text-red-700 underline" onClick={() => setRascunho(campos.filter((_, j) => j !== i))}>
              {t("Remover")}
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setRascunho([...campos, { key: `campo_${campos.length + 1}`, label: t("Novo campo"), tipo: "texto", obrigatorio: false }])
            }
          >
            {t("+ Campo")}
          </Button>
          <Button size="sm" disabled={salvar.isPending || rascunho === null} onClick={() => salvar.mutate()}>
            {t("Salvar campos")}
          </Button>
        </div>
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
      </div>
    </details>
  );
}
