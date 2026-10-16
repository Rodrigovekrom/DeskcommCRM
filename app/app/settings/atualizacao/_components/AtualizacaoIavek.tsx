"use client";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { ROTULO_DA_VERSAO } from "@/lib/iavek/versao";

/**
 * ia.vek: no lugar do painel "Atualizar agora" do upstream. O sistema é nosso,
 * e a versão nova chega pela troca de imagem feita pela equipe — nunca pelo
 * `update.sh` do DeskcommCRM, que desfaria a marca e as funções do ia.vek.
 */
export function AtualizacaoIavek() {
  const t = useT();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">{t("Atualização do sistema")}</h1>
      <Card className="space-y-2 p-5" data-testid="atualizacao-iavek">
        <p className="text-sm font-medium">{ROTULO_DA_VERSAO}</p>
        <p className="text-sm text-muted-foreground">
          {t("As atualizações do ia.vek CRM são feitas pela equipe. Não há nada a fazer por aqui.")}
        </p>
      </Card>
    </div>
  );
}
