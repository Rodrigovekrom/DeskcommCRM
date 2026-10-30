"use client";
/**
 * ia.vek v1.9.4 — o TRAJETO DO LEAD EM 72h na tela (CRM-209).
 *
 * O cartão "Passagem" é o RESUMO para quem recebe: com quem está o lead, o
 * guardião, o prazo das 72h, os 7 campos e a última passagem (contexto,
 * objeção, próximo passo, motivo de quem desistiu). Embaixo, as ações que
 * QUEM ESTÁ CONECTADO pode fazer (o servidor decide): passar para negociar,
 * devolver ao guardião, trocar o vendedor, reativar. Só na loja.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { CamposDaPassagemForm, camposIniciais, camposParaEnviar } from "@/components/iavek/CamposDaPassagemForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { apiClient } from "@/lib/api/client";
import { CONTEXTO_MINIMO, type CamposDaPassagem } from "@/lib/iavek/passagem";

interface Historico {
  id: string;
  tipo: string;
  quando: string;
  quem: string | null;
  de: string | null;
  para: string | null;
  detalhes: Record<string, unknown>;
}
interface DadosDaPassagem {
  loja: boolean;
  dono: { id: string | null; nome: string | null; funcao: string | null };
  guardiao: { id: string | null; nome: string | null; funcao: string | null };
  objetivo: { titulo: string; vence_em: string | null } | null;
  dentro_das_72h: boolean;
  fim_das_72h: string;
  no_followup: boolean;
  campos: Record<string, unknown>;
  faltam: string[];
  pode: { negociar: boolean; devolver: boolean; trocar_vendedor: boolean; reativar: boolean };
  vendedores: Array<{ id: string; nome: string }>;
  motivos_de_desistencia: string[];
  historico: Historico[];
}
type Acao = "negociar" | "devolver" | "trocar_vendedor" | "reativar";

const ROTULO_DO_TIPO: Record<string, string> = {
  agendamento: "Agendou e passou ao vendedor",
  negociar: "Passou para negociar",
  devolver: "Vendedor devolveu ao guardião",
  trocar_vendedor: "Passou a outro vendedor",
  reativar: "Reativou e voltou ao guardião",
};
const SELECT = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

function dataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function PassagemDoLead({ leadId }: { leadId: string | null | undefined }) {
  const { lojaDeCarros, modo_agendamento } = usePerfilDaEmpresa();
  if (!leadId || !lojaDeCarros || modo_agendamento) return null;
  return <PassagemDaLoja leadId={leadId} />;
}

function PassagemDaLoja({ leadId }: { leadId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const chave = ["iavek", "passagem", leadId];
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () => apiClient.get<{ data: DadosDaPassagem }>(`/api/v1/iavek/passagem?lead_id=${leadId}`).then((r) => r.data),
  });
  const [acao, setAcao] = useState<Acao | null>(null);
  const [campos, setCampos] = useState<CamposDaPassagem>({});
  const [contexto, setContexto] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [objecao, setObjecao] = useState("");
  const [passo, setPasso] = useState("");
  const [quando, setQuando] = useState("");
  const [motivo, setMotivo] = useState("");
  const [feito, setFeito] = useState("");
  const [sugerido, setSugerido] = useState("");

  const enviar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => apiClient.post("/api/v1/iavek/passagem", { lead_id: leadId, ...corpo }),
    onSuccess: () => {
      toast.success(t("Passagem feita."));
      setAcao(null);
      void qc.invalidateQueries({ queryKey: chave });
      void qc.invalidateQueries({ queryKey: ["iavek"] });
    },
    onError: showApiError,
  });

  if (!data || !data.loja) return null;
  const ultima = data.historico[0];

  function abrir(a: Acao) {
    setAcao(a);
    setCampos(camposIniciais(data?.campos));
    setContexto("");
    setVendedorId("");
    setObjecao("");
    setPasso("");
    setQuando("");
    setMotivo("");
    setFeito("");
    setSugerido("");
  }

  const pronto =
    acao === "negociar"
      ? Boolean(vendedorId) && contexto.trim().length >= CONTEXTO_MINIMO && objecao.trim().length >= 3 && passo.trim().length >= 3 && Boolean(quando)
      : acao === "devolver"
        ? Boolean(motivo) && feito.trim().length >= 10 && sugerido.trim().length >= 3
        : acao === "trocar_vendedor"
          ? Boolean(vendedorId) && motivo.trim().length >= 3
          : acao === "reativar";

  function confirmar() {
    if (acao === "negociar") {
      enviar.mutate({
        tipo: "negociar",
        vendedor_id: vendedorId,
        campos: camposParaEnviar(campos),
        contexto: contexto.trim(),
        objecao: objecao.trim(),
        proximo_passo: { o_que: passo.trim(), quando: new Date(quando).toISOString() },
      });
    } else if (acao === "devolver") {
      enviar.mutate({ tipo: "devolver", motivo, feito: feito.trim(), proximo_passo_sugerido: sugerido.trim() });
    } else if (acao === "trocar_vendedor") {
      enviar.mutate({ tipo: "trocar_vendedor", vendedor_id: vendedorId, motivo: motivo.trim() });
    } else if (acao === "reativar") {
      enviar.mutate({ tipo: "reativar", ...(motivo.trim() ? { motivo: motivo.trim() } : {}) });
    }
  }

  const titulo: Record<Acao, string> = {
    negociar: "Passar para negociar",
    devolver: "Devolver ao guardião",
    trocar_vendedor: "Passar a outro vendedor",
    reativar: "Reativar (volta ao guardião)",
  };
  const detalhe = (k: string) => {
    const v = ultima?.detalhes?.[k];
    if (v && typeof v === "object" && "o_que" in (v as object)) {
      const p = v as { o_que: string; quando: string };
      return `${p.o_que} (${dataHora(p.quando)})`;
    }
    return typeof v === "string" && v ? v : null;
  };

  return (
    <section className="space-y-2 rounded-md border border-border p-3 text-sm" data-testid="cartao-da-passagem">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Passagem")}</h3>
        <span className={data.dentro_das_72h ? "text-xs text-muted-foreground" : "text-xs font-medium text-destructive"}>
          {data.no_followup
            ? t("No follow-up (só reativar)")
            : data.dentro_das_72h
              ? `${t("72h até")} ${dataHora(data.fim_das_72h)}`
              : t("72h encerradas")}
        </span>
      </div>
      <p className="text-xs" data-testid="passagem-responsavel">
        {t("Responsável")}: <strong>{data.dono.nome ?? t("sem dono")}</strong>
        {data.dono.funcao ? ` (${data.dono.funcao})` : ""}
        {data.guardiao.nome && data.guardiao.id !== data.dono.id
          ? ` · ${t("Guardião")}: ${data.guardiao.nome}${data.guardiao.funcao ? ` (${data.guardiao.funcao})` : ""}`
          : ""}
      </p>
      <p className="text-xs" data-testid="passagem-objetivo">
        {t("Objetivo")}:{" "}
        {data.objetivo ? `${data.objetivo.titulo}${data.objetivo.vence_em ? ` · ${dataHora(data.objetivo.vence_em)}` : ""}` : t("sem próximo passo")}
      </p>
      {data.faltam.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="passagem-faltam">
          {t("Faltam para passar")}: {data.faltam.map(t).join(", ")}
        </p>
      )}
      {ultima && (
        <div className="space-y-0.5 rounded-md bg-muted/40 p-2 text-xs" data-testid="passagem-ultima">
          <p className="font-medium">
            {t(ROTULO_DO_TIPO[ultima.tipo] ?? "Passagem")} · {dataHora(ultima.quando)}
          </p>
          {(ultima.de || ultima.para) && (
            <p>
              {ultima.de ?? "—"} → {ultima.para ?? "—"}
            </p>
          )}
          {detalhe("contexto") && <p>{t("Contexto")}: {detalhe("contexto")}</p>}
          {detalhe("objecao") && <p>{t("Objeção")}: {detalhe("objecao")}</p>}
          {detalhe("proximo_passo") && <p>{t("Próximo passo")}: {detalhe("proximo_passo")}</p>}
          {detalhe("motivo") && <p>{t("Motivo")}: {detalhe("motivo")}</p>}
          {detalhe("feito") && <p>{t("O que já foi feito")}: {detalhe("feito")}</p>}
          {detalhe("proximo_passo_sugerido") && <p>{t("Próximo passo sugerido")}: {detalhe("proximo_passo_sugerido")}</p>}
        </div>
      )}
      {data.historico.length > 1 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{t("Passagens anteriores")}</summary>
          <ul className="mt-1 space-y-0.5">
            {data.historico.slice(1).map((h) => (
              <li key={h.id}>
                {dataHora(h.quando)} · {t(ROTULO_DO_TIPO[h.tipo] ?? "Passagem")}
                {typeof h.detalhes.motivo === "string" ? ` · ${h.detalhes.motivo}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-1">
        {(Object.keys(titulo) as Acao[])
          .filter((a) => data.pode[a])
          .map((a) => (
            <Button key={a} size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => abrir(a)} data-testid={`passagem-${a}`}>
              {t(titulo[a])}
            </Button>
          ))}
      </div>

      <Dialog open={acao !== null} onOpenChange={(o) => !o && setAcao(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{acao ? t(titulo[acao]) : ""}</DialogTitle>
            <DialogDescription>
              {acao === "negociar"
                ? t("O vendedor recebe o lead com tudo o que você levantou, sem repetir perguntas. Você continua como guardião.")
                : acao === "devolver"
                  ? t("O lead volta para o guardião com o motivo e o que você já fez.")
                  : acao === "trocar_vendedor"
                    ? t("O vendedor atual é avisado de que perdeu o lead. O histórico vai junto para o novo.")
                    : t("O lead volta para o guardião e começa um novo ciclo de 72h.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(acao === "negociar" || acao === "trocar_vendedor") && (
              <div className="space-y-1">
                <Label htmlFor="passagem-vendedor">{t("Vendedor")}</Label>
                <select id="passagem-vendedor" className={SELECT} value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} data-testid="passagem-vendedor">
                  <option value="">{t("Escolha o vendedor")}</option>
                  {data.vendedores
                    .filter((v) => acao !== "trocar_vendedor" || v.id !== data.dono.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {acao === "negociar" && (
              <>
                <CamposDaPassagemForm valor={campos} aoMudar={setCampos} contexto={contexto} aoMudarContexto={setContexto} />
                <div className="space-y-1">
                  <Label htmlFor="passagem-objecao">{t("Objeção principal")}</Label>
                  <Input id="passagem-objecao" value={objecao} onChange={(e) => setObjecao(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="passagem-passo">{t("Próximo passo combinado")}</Label>
                    <Input id="passagem-passo" value={passo} onChange={(e) => setPasso(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="passagem-quando">{t("Quando")}</Label>
                    <Input id="passagem-quando" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
                  </div>
                </div>
              </>
            )}
            {acao === "devolver" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="passagem-motivo">{t("Motivo")}</Label>
                  <select id="passagem-motivo" className={SELECT} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="passagem-motivo">
                    <option value="">{t("Escolha o motivo")}</option>
                    {data.motivos_de_desistencia.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="passagem-feito">{t("O que já foi feito")}</Label>
                  <textarea id="passagem-feito" rows={3} maxLength={2000} value={feito} onChange={(e) => setFeito(e.target.value)} className="w-full rounded-md border border-border bg-background p-2 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="passagem-sugerido">{t("Próximo passo sugerido")}</Label>
                  <Input id="passagem-sugerido" value={sugerido} onChange={(e) => setSugerido(e.target.value)} />
                </div>
              </>
            )}
            {(acao === "trocar_vendedor" || acao === "reativar") && (
              <div className="space-y-1">
                <Label htmlFor="passagem-motivo-curto">{acao === "reativar" ? t("Por que reativar (opcional)") : t("Motivo (ex.: vendedor sem ação)")}</Label>
                <Input id="passagem-motivo-curto" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="passagem-motivo-curto" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcao(null)}>
              {t("Cancelar")}
            </Button>
            <Button onClick={confirmar} disabled={!pronto || enviar.isPending} data-testid="passagem-confirmar">
              {t("Confirmar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
