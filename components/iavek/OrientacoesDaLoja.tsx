"use client";
/**
 * ia.vek CRM-439 fase 1 (migration 0651): as orientações da loja e as novidades da versão, na tela.
 *
 *   - `OrientacoesParaVoce`: o bloco do topo do Meu dia, só com o que falta ler, cada um com "Li e entendi". Não abre
 *     janela por cima de nada (regra 2 do Rodrigo: não trava a tela).
 *   - `ManualDaLoja`: o que vale hoje (não substituído), já lido ou não. Para o gestor, também o envio e as enviadas
 *     com "X de Y leram" e o "quem não leu" de cada uma.
 *
 * Não se edita depois de enviado (regra 3): para corrigir, envia outra que "corrige uma anterior".
 */
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ROLE_RANK } from "@/lib/auth/types";
import {
  FUNCOES_ALVO,
  pendentesDoMeuDia,
  queAindaValem,
  rotuloDoAlvo,
  type FuncaoAlvo,
} from "@/lib/iavek/comunicados";

export interface ComunicadoMeu {
  id: string;
  tipo: "orientacao" | "novidade";
  titulo: string;
  texto: string;
  pede_leitura: boolean;
  enviado_em: string;
  enviado_por_nome: string | null;
  substitui_id: string | null;
  versao: string | null;
  lido: boolean;
  lida_em: string | null;
  substituido_por: string | null;
}

interface ComunicadoEnviado {
  id: string;
  tipo: "orientacao" | "novidade";
  titulo: string;
  texto: string;
  alvo: "funcao" | "pessoa";
  para_funcao: FuncaoAlvo | null;
  para_usuario_nome: string | null;
  enviado_em: string;
  enviado_por_nome: string | null;
  versao: string | null;
  substituido_por: string | null;
  leitura: { lidos: number; total: number; faltam: number };
}

interface Pessoa {
  user_id: string;
  full_name: string | null;
}

const CHAVE_MEUS = ["iavek", "comunicados", "meus"] as const;
const CHAVE_ENVIADOS = ["iavek", "comunicados", "enviados"] as const;

/** Preenche o molde já traduzido ("{quando}", "{quem}"…) pelas chaves, sem literal de texto na tela. */
function preencher(molde: string, valores: Record<string, string>): string {
  return molde.replace(/\{(\w+)\}/g, (inteiro, chave: string) => valores[chave] ?? inteiro);
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useMeus() {
  return useQuery({
    queryKey: CHAVE_MEUS,
    queryFn: () =>
      apiClient
        .get<{ data: { comunicados: ComunicadoMeu[] } }>("/api/v1/iavek/comunicados?para=mim")
        .then((r) => r.data),
    refetchInterval: 120_000,
  });
}

function useEhGestor(): boolean {
  const { user, activeOrg } = useAuth();
  if (user.is_platform_admin && !user.support) return true;
  return activeOrg ? ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager : false;
}

function BotaoLi({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [enviando, setEnviando] = useState(false);
  if (user.support) return null;
  return (
    <Button
      size="sm"
      disabled={enviando}
      data-testid={`li-e-entendi-${id}`}
      onClick={() => {
        setEnviando(true);
        void apiClient
          .post(`/api/v1/iavek/comunicados/${id}/li`, {})
          .then(() => {
            void qc.invalidateQueries({ queryKey: CHAVE_MEUS });
            void qc.invalidateQueries({ queryKey: ["iavek", "notificacoes"] });
          })
          .catch(showApiError)
          .finally(() => setEnviando(false));
      }}
    >
      {t("Li e entendi")}
    </Button>
  );
}

function Cabecalho({
  c,
}: {
  c: Pick<ComunicadoMeu, "tipo" | "versao" | "enviado_em" | "enviado_por_nome">;
}) {
  const t = useT();
  const origem =
    c.tipo === "novidade"
      ? preencher(t("Novidade da versão {versao}"), { versao: c.versao ?? "—" })
      : preencher(t("Orientação de {quem}"), { quem: c.enviado_por_nome ?? t("Gerência") });
  return (
    <p className="text-xs text-muted-foreground">
      {origem} · {quando(c.enviado_em)}
    </p>
  );
}

/** O bloco do topo do Meu dia: só o que pede leitura e ainda não foi lido. Some quando não há nada. */
export function OrientacoesParaVoce() {
  const t = useT();
  const { data } = useMeus();
  const pendentes = pendentesDoMeuDia(data?.comunicados ?? []);
  if (pendentes.length === 0) return null;
  return (
    <section
      className="rounded-lg border border-primary/40 bg-background p-3"
      data-testid="orientacoes-para-voce"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("Orientações para você")}</h2>
        <Link href="/app/manual-da-loja" className="text-xs text-muted-foreground underline">
          {t("Ver o Manual da loja")}
        </Link>
      </div>
      <ul className="space-y-3">
        {pendentes.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-border p-3"
            data-testid={`orientacao-${c.id}`}
          >
            <p className="text-sm font-medium">{c.titulo}</p>
            <Cabecalho c={c} />
            <p className="mt-2 text-sm whitespace-pre-wrap">{c.texto}</p>
            <div className="mt-2">
              <BotaoLi id={c.id} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuemLeu({ id }: { id: string }) {
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ["iavek", "comunicados", "leituras", id],
    queryFn: () =>
      apiClient
        .get<{
          data: {
            pessoas: Array<{ user_id: string; nome: string | null; lida_em: string | null }>;
          };
        }>(`/api/v1/iavek/comunicados/${id}/leituras`)
        .then((r) => r.data),
  });
  if (isLoading || !data)
    return <p className="text-xs text-muted-foreground">{t("Carregando…")}</p>;
  return (
    <ul className="mt-2 space-y-1 text-xs" data-testid={`quem-leu-${id}`}>
      {data.pessoas.map((p) => (
        <li key={p.user_id} className="flex justify-between gap-2">
          <span>{p.nome ?? t("Sem nome")}</span>
          <span className={p.lida_em ? "text-muted-foreground" : "font-medium text-destructive"}>
            {p.lida_em
              ? preencher(t("leu em {quando}"), { quando: quando(p.lida_em) })
              : t("não leu")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EnviarOrientacao({
  corrige,
  aoEnviar,
}: {
  corrige: ComunicadoEnviado | null;
  aoEnviar: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [alvo, setAlvo] = useState<"funcao" | "pessoa">(corrige?.alvo ?? "funcao");
  const [funcao, setFuncao] = useState<FuncaoAlvo>(corrige?.para_funcao ?? "vendedor");
  const [pessoa, setPessoa] = useState("");
  const [titulo, setTitulo] = useState(corrige ? corrige.titulo : "");
  const [texto, setTexto] = useState(corrige ? corrige.texto : "");
  const [enviando, setEnviando] = useState(false);
  const { data: pessoas } = useQuery({
    queryKey: ["team", "assignable"],
    queryFn: () => apiClient.get<{ data: Pessoa[] }>("/api/v1/team/assignable").then((r) => r.data),
    enabled: alvo === "pessoa",
  });
  const pronto =
    titulo.trim().length > 0 && texto.trim().length > 0 && (alvo === "funcao" || pessoa !== "");
  return (
    <form
      className="space-y-2 rounded-lg border border-border p-3"
      data-testid="enviar-orientacao"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pronto) return;
        setEnviando(true);
        const corpo =
          alvo === "funcao"
            ? {
                alvo,
                para_funcao: funcao,
                titulo,
                texto,
                ...(corrige ? { substitui_id: corrige.id } : {}),
              }
            : {
                alvo,
                para_usuario: pessoa,
                titulo,
                texto,
                ...(corrige ? { substitui_id: corrige.id } : {}),
              };
        void apiClient
          .post<{ data: { destinatarios: number } }>("/api/v1/iavek/comunicados", corpo)
          .then((r) => {
            toast.success(
              preencher(t("Orientação enviada para {n} pessoa(s)."), {
                n: String(r.data.destinatarios),
              }),
            );
            setTitulo("");
            setTexto("");
            void qc.invalidateQueries({ queryKey: CHAVE_ENVIADOS });
            aoEnviar();
          })
          .catch(showApiError)
          .finally(() => setEnviando(false));
      }}
    >
      <h2 className="text-sm font-semibold">
        {corrige
          ? preencher(t("Corrigir: {titulo}"), { titulo: corrige.titulo })
          : t("Enviar uma orientação")}
      </h2>
      {corrige && (
        <p className="text-xs text-muted-foreground">
          {t("A anterior não muda: esta nova fica no lugar dela, e as duas ficam no histórico.")}
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="alvo"
            checked={alvo === "funcao"}
            onChange={() => setAlvo("funcao")}
          />
          {t("Para uma função")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="alvo"
            checked={alvo === "pessoa"}
            onChange={() => setAlvo("pessoa")}
          />
          {t("Para uma pessoa")}
        </label>
      </div>
      {alvo === "funcao" ? (
        <select
          aria-label={t("Função")}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          value={funcao}
          onChange={(e) => setFuncao(e.target.value as FuncaoAlvo)}
        >
          {FUNCOES_ALVO.map((f) => (
            <option key={f} value={f}>
              {t(rotuloDoAlvo(f))}
            </option>
          ))}
        </select>
      ) : (
        <select
          aria-label={t("Pessoa")}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          value={pessoa}
          onChange={(e) => setPessoa(e.target.value)}
        >
          <option value="">{t("Escolha a pessoa")}</option>
          {(pessoas ?? []).map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.full_name ?? t("Sem nome")}
            </option>
          ))}
        </select>
      )}
      <Input
        aria-label={t("Título")}
        placeholder={t("Título")}
        maxLength={120}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
      />
      <Textarea
        aria-label={t("Texto da orientação")}
        placeholder={t("Texto da orientação")}
        maxLength={4000}
        rows={5}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {t("Depois de enviada, a orientação não se edita nem se apaga.")}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!pronto || enviando}>
          {t("Enviar")}
        </Button>
        {corrige && (
          <Button type="button" size="sm" variant="outline" onClick={aoEnviar}>
            {t("Cancelar")}
          </Button>
        )}
      </div>
    </form>
  );
}

function Enviadas() {
  const t = useT();
  const [aberto, setAberto] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState<ComunicadoEnviado | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: CHAVE_ENVIADOS,
    queryFn: () =>
      apiClient
        .get<{ data: { comunicados: ComunicadoEnviado[] } }>("/api/v1/iavek/comunicados?enviados=1")
        .then((r) => r.data),
  });
  return (
    <div className="space-y-3">
      <EnviarOrientacao
        key={corrigindo?.id ?? "nova"}
        corrige={corrigindo}
        aoEnviar={() => setCorrigindo(null)}
      />
      <h2 className="text-sm font-semibold">{t("Enviadas")}</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
      ) : (data?.comunicados ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhuma orientação enviada ainda.")}</p>
      ) : (
        <ul className="space-y-2" data-testid="orientacoes-enviadas">
          {(data?.comunicados ?? []).map((c) => (
            <li key={c.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{c.titulo}</p>
                <span className="text-xs" data-testid={`x-de-y-${c.id}`}>
                  {preencher(t("{x} de {y} leram"), {
                    x: String(c.leitura.lidos),
                    y: String(c.leitura.total),
                  })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {c.alvo === "funcao" && c.para_funcao
                  ? preencher(t("Para: {quem}"), { quem: t(rotuloDoAlvo(c.para_funcao)) })
                  : preencher(t("Para: {quem}"), { quem: c.para_usuario_nome ?? t("Sem nome") })}
                {" · "}
                {quando(c.enviado_em)}
                {c.substituido_por ? ` · ${t("substituída por uma mais nova")}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAberto(aberto === c.id ? null : c.id)}
                >
                  {aberto === c.id ? t("Esconder quem leu") : t("Ver quem leu")}
                </Button>
                {c.tipo === "orientacao" && !c.substituido_por && (
                  <Button size="sm" variant="outline" onClick={() => setCorrigindo(c)}>
                    {t("Corrigir com uma nova")}
                  </Button>
                )}
              </div>
              {aberto === c.id && <QuemLeu id={c.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** O Manual da loja: o que vale hoje para a pessoa; para o gestor, também o envio e as enviadas. */
export function ManualDaLoja() {
  const t = useT();
  const gestor = useEhGestor();
  const { data, isLoading } = useMeus();
  const valem = queAindaValem(data?.comunicados ?? []);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5" data-testid="manual-da-loja">
      <header>
        <h1 className="text-xl font-semibold">{t("Manual da loja")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("As orientações da loja e as novidades do sistema que valem hoje para você.")}
        </p>
      </header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
      ) : valem.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhuma orientação para você ainda.")}</p>
      ) : (
        <ul className="space-y-3">
          {valem.map((c) => (
            <li
              key={c.id}
              id={`comunicado-${c.id}`}
              className="rounded-md border border-border p-3"
            >
              <p className="text-sm font-medium">{c.titulo}</p>
              <Cabecalho c={c} />
              <p className="mt-2 text-sm whitespace-pre-wrap">{c.texto}</p>
              <div className="mt-2 text-xs text-muted-foreground">
                {c.lido && c.lida_em ? (
                  preencher(t("Você leu em {quando}"), { quando: quando(c.lida_em) })
                ) : c.pede_leitura ? (
                  <BotaoLi id={c.id} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {gestor && (
        <section
          className="space-y-3 border-t border-border pt-4"
          data-testid="orientacoes-da-gerencia"
        >
          <h2 className="text-base font-semibold">{t("Orientações da gerência")}</h2>
          <Enviadas />
        </section>
      )}
    </div>
  );
}
