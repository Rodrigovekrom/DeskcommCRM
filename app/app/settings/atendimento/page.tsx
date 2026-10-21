/**
 * Configurações → Distribuição de atendimento (issue #144).
 *
 * A TELA QUE FALTAVA. O rodízio entre atendentes (`settings.routing.mode =
 * round_robin`, worker em `lib/routing/`) e a restrição de visibilidade por
 * atendente (`settings.visibility_mode`, RLS em `fn_can_view_lead` /
 * `fn_can_view_conversation`) existem inteiros no backend desde a fase G4/G5 —
 * e não havia UMA tela no produto que os ligasse. Medido antes de escrever:
 * nenhum arquivo de `app/` ou `components/` consumia `/api/v1/settings/routing`,
 * e `visibility_mode` só aparecia sendo LIDO em `app/app/layout.tsx`.
 *
 * Num produto self-host isso equivale a a feature não existir: a única forma de
 * ligar era `UPDATE` à mão no Postgres. É o anti-exemplo literal de "toda
 * configuração tem superfície" (`docs/doctrine/restricao-de-canal.md`).
 *
 * Gate = manager+, que é o que a matriz da spec 13 §4 dá para
 * "atendimento/routing" — a mesma linha cobre as duas chaves.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { DEFAULT_VISIBILITY_MODE, ROLE_RANK, type VisibilityMode } from "@/lib/auth/types";
import { routingConfigSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { loadChannelRoutingSettings } from "@/lib/routing/channel-policies";
import { configAssinatura, ROTULOS_FUNCAO_PADRAO } from "@/lib/messaging/assinatura";
import { AssinaturaForm } from "./_assinatura-form";
import { ChannelRoutingForm } from "./_channels-form";
import { AtendimentoForm } from "./_form";
import { EsteiraForm } from "./_esteira-form";
import { AvisoGrupoForm } from "./_aviso-grupo-form";
import { configDoAvisoGrupo } from "@/lib/avisos-grupo/regras";
import { configDaEsteira } from "@/lib/esteira/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export default async function AtendimentoSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();

  const settings = ((data?.settings as Record<string, unknown> | null) ?? {}) as {
    routing?: unknown;
    visibility_mode?: VisibilityMode;
  };
  // `.catch(...)`: config antiga ou corrompida no jsonb não pode derrubar a
  // tela que serve justamente para consertá-la.
  const routing = routingConfigSchema
    .catch(routingConfigSchema.parse({}))
    .parse(settings.routing ?? {});
  const idioma = user.idioma;
  const channels = await loadChannelRoutingSettings(supabase, activeOrg.orgId);
  const assinatura = configAssinatura(settings);
  const assinaturaInicial = {
    humanos: assinatura.humanos,
    ia: assinatura.ia,
    nome_ia: assinatura.nomeIa,
    rotulos_funcao: assinatura.rotulosFuncao ?? ROTULOS_FUNCAO_PADRAO,
  };

  // ia.vek D3: esteira de vendas (escalada e relatório por papel ou pessoa).
  const esteira = configDaEsteira(settings);
  const admin = createAdminClient();
  const nomeDoFunil = async (id: string) =>
    (
      (
        await admin
          .from("crm_pipelines")
          .select("name")
          .eq("organization_id", activeOrg.orgId)
          .eq("id", id)
          .maybeSingle()
      ).data as { name?: string } | null
    )?.name ?? id;
  const salvoEsteira = ((settings as { esteira?: unknown }).esteira ?? {}) as Record<
    string,
    unknown
  >;
  const declarados =
    salvoEsteira.entrada && salvoEsteira.followup
      ? {
          entrada: await nomeDoFunil((salvoEsteira.entrada as { pipeline_id: string }).pipeline_id),
          followup: await nomeDoFunil(
            (salvoEsteira.followup as { pipeline_id: string }).pipeline_id,
          ),
        }
      : null;
  const { data: vinculos } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", activeOrg.orgId);
  const membros: Array<{ id: string; nome: string }> = [];
  for (const v of (vinculos ?? []) as Array<{ user_id: string }>) {
    const { data: u } = await admin.auth.admin.getUserById(v.user_id);
    const meta = (u?.user?.user_metadata ?? {}) as { full_name?: string; name?: string };
    membros.push({
      id: v.user_id,
      nome: meta.full_name || meta.name || u?.user?.email || v.user_id,
    });
  }
  membros.sort((a, b) => a.nome.localeCompare(b.nome));

  // ia.vek D4: grupo de avisos da equipe — só grupos conhecidos dos números.
  const { data: gruposConhecidos } = await admin
    .from("channel_session_groups")
    .select("channel_session_id, group_chat_id, subject")
    .eq("organization_id", activeOrg.orgId)
    .order("subject", { ascending: true });
  const grupos = (
    (gruposConhecidos ?? []) as Array<{
      channel_session_id: string;
      group_chat_id: string;
      subject: string | null;
    }>
  ).map((g) => ({
    channel_session_id: g.channel_session_id,
    group_chat_id: g.group_chat_id,
    rotulo: g.subject || g.group_chat_id,
  }));
  const avisoGrupo = configDoAvisoGrupo(settings);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Distribuição de atendimento", idioma)}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {traduzir(
            "Quem recebe cada cliente novo, e o que cada atendente enxerga. As duas decisões andam juntas: distribuir sem restringir deixa todo mundo vendo a carteira do colega; restringir sem distribuir deixa o funil de cada um vazio.",
            idioma,
          )}
        </p>
      </header>

      <AtendimentoForm
        initial={{
          ...routing,
          visibility_mode: settings.visibility_mode ?? DEFAULT_VISIBILITY_MODE,
        }}
      />
      <ChannelRoutingForm initial={channels} />
      <AssinaturaForm initial={assinaturaInicial} />
      <EsteiraForm
        initial={{
          salvo: salvoEsteira,
          emVigor: {
            escalada: esteira.escalada,
            escaladaNivel2: esteira.escaladaNivel2,
            relatorioSemanal: esteira.relatorioSemanal,
            escaladaHoras: esteira.escaladaHoras,
            escaladaHorasNivel2: esteira.escaladaHorasNivel2,
          },
          funis: declarados,
          membros,
          podeSalvar: activeOrg.role === "admin" || (user.is_platform_admin && !user.support),
        }}
      />
      <AvisoGrupoForm
        grupos={grupos}
        podeSalvar={activeOrg.role === "admin" || (user.is_platform_admin && !user.support)}
        initial={{
          grupo: avisoGrupo ? `${avisoGrupo.channel_session_id}|${avisoGrupo.group_chat_id}` : "",
          espacamento_segundos: avisoGrupo?.espacamento_segundos ?? 60,
          teto_diario: avisoGrupo?.teto_diario ?? 30,
        }}
      />
    </div>
  );
}
