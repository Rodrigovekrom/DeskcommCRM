"use client";
/**
 * ia.vek v1.9.4 — os 7 campos da passagem do lead (CRM-209), preenchidos a
 * partir do negócio. Usado no "Marcar agendamento" do SDR e no "Passar para
 * negociar". O que já está no negócio vem preenchido; o servidor grava o que
 * mudar e confere o que falta (a trava é dele, não desta tela).
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import type { CamposDaPassagem } from "@/lib/iavek/passagem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

/** O que o negócio já tem, no formato do formulário. */
export function camposIniciais(c: Record<string, unknown> | null | undefined): CamposDaPassagem {
  const v = c ?? {};
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" && !Number.isNaN(Number(x)) ? Number(x) : undefined);
  const str = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x : undefined);
  const troca = v.tem_troca === true || v.tem_troca === "true" ? true : v.tem_troca === false || v.tem_troca === "false" ? false : undefined;
  return {
    carro_interesse: str(v.carro_interesse),
    cidade: str(v.cidade),
    forma_pagamento: str(v.forma_pagamento) as CamposDaPassagem["forma_pagamento"],
    entrada_reais: num(v.entrada_reais),
    tem_troca: troca,
    troca_modelo: str(v.troca_modelo),
    troca_ano: num(v.troca_ano),
    prazo_compra: str(v.prazo_compra) as CamposDaPassagem["prazo_compra"],
  };
}

/** Só o que tem valor (o servidor faz o merge no negócio). */
export function camposParaEnviar(c: CamposDaPassagem): CamposDaPassagem {
  return Object.fromEntries(Object.entries(c).filter(([, x]) => x !== undefined && x !== "")) as CamposDaPassagem;
}

export function CamposDaPassagemForm({
  valor,
  aoMudar,
  contexto,
  aoMudarContexto,
}: {
  valor: CamposDaPassagem;
  aoMudar: (v: CamposDaPassagem) => void;
  contexto?: string;
  aoMudarContexto?: (v: string) => void;
}) {
  const t = useT();
  const muda = (patch: Partial<CamposDaPassagem>) => aoMudar({ ...valor, ...patch });
  const carroDoCatalogo = typeof valor.carro_interesse === "string" && UUID.test(valor.carro_interesse);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="campos-da-passagem">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="passagem-carro">{t("Carro de interesse")}</Label>
        <Input
          id="passagem-carro"
          value={carroDoCatalogo ? "" : (valor.carro_interesse ?? "")}
          placeholder={carroDoCatalogo ? t("Já escolhido no catálogo (digite para trocar)") : t("Modelo e ano")}
          onChange={(e) => muda({ carro_interesse: e.target.value || (carroDoCatalogo ? valor.carro_interesse : undefined) })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="passagem-cidade">{t("Cidade / região")}</Label>
        <Input id="passagem-cidade" value={valor.cidade ?? ""} onChange={(e) => muda({ cidade: e.target.value || undefined })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="passagem-pagamento">{t("Forma de pagamento")}</Label>
        <select
          id="passagem-pagamento"
          className={SELECT}
          value={valor.forma_pagamento ?? ""}
          onChange={(e) => muda({ forma_pagamento: (e.target.value || undefined) as CamposDaPassagem["forma_pagamento"] })}
        >
          <option value="">{t("Escolha")}</option>
          <option value="a_vista">{t("À vista")}</option>
          <option value="financiamento">{t("Financiamento")}</option>
          <option value="consorcio">{t("Consórcio")}</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="passagem-entrada">{t("Entrada (R$; 0 = sem entrada)")}</Label>
        <Input
          id="passagem-entrada"
          type="number"
          min={0}
          value={valor.entrada_reais ?? ""}
          onChange={(e) => muda({ entrada_reais: e.target.value === "" ? undefined : Number(e.target.value) })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="passagem-prazo">{t("Prazo para comprar")}</Label>
        <select
          id="passagem-prazo"
          className={SELECT}
          value={valor.prazo_compra ?? ""}
          onChange={(e) => muda({ prazo_compra: (e.target.value || undefined) as CamposDaPassagem["prazo_compra"] })}
        >
          <option value="">{t("Escolha")}</option>
          <option value="0_7">{t("0 a 7 dias")}</option>
          <option value="7_15">{t("7 a 15 dias")}</option>
          <option value="15_30">{t("15 a 30 dias")}</option>
          <option value="30_mais">{t("Mais de 30 dias")}</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="passagem-troca">{t("Tem carro na troca?")}</Label>
        <select
          id="passagem-troca"
          className={SELECT}
          value={valor.tem_troca === undefined ? "" : valor.tem_troca ? "sim" : "nao"}
          onChange={(e) => muda({ tem_troca: e.target.value === "" ? undefined : e.target.value === "sim" })}
        >
          <option value="">{t("Escolha")}</option>
          <option value="sim">{t("Sim")}</option>
          <option value="nao">{t("Não")}</option>
        </select>
      </div>
      {valor.tem_troca === true && (
        <>
          <div className="space-y-1">
            <Label htmlFor="passagem-troca-modelo">{t("Troca: modelo")}</Label>
            <Input id="passagem-troca-modelo" value={valor.troca_modelo ?? ""} onChange={(e) => muda({ troca_modelo: e.target.value || undefined })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="passagem-troca-ano">{t("Troca: ano")}</Label>
            <Input
              id="passagem-troca-ano"
              type="number"
              value={valor.troca_ano ?? ""}
              onChange={(e) => muda({ troca_ano: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </div>
        </>
      )}
      {aoMudarContexto && (
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="passagem-contexto">{t("Contexto do atendimento")}</Label>
          <textarea
            id="passagem-contexto"
            value={contexto ?? ""}
            onChange={(e) => aoMudarContexto(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder={t("O que o cliente quer, o que já foi conversado, o que o vendedor precisa saber")}
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
          />
        </div>
      )}
    </div>
  );
}
