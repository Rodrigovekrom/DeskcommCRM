"use client";
import { ForaDoPadrao } from "@/components/iavek/PadraoDoLead";
import { LeadsIncompletos } from "@/components/iavek/CamposObrigatorios";
import { NotasDaSemana } from "@/components/iavek/NotaDoAtendimento";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { fraseDoDia } from "@/lib/iavek/frase-do-dia";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ROLE_RANK } from "@/lib/auth/types";
import { corDoCronometro, textoDoRestante } from "@/lib/iavek/cronometro-72h";
import { ROTULO_DA_FUNCAO, funcaoDaTela, type Funcao } from "@/lib/iavek/funcoes";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { SecaoRecolhivel } from "@/components/inbox/SecaoRecolhivel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PedidosDeAgendamento } from "@/components/iavek/PedidosDeAgendamento";

/**
 * ia.vek v1.6 (parte B): o "Meu dia" — a tela inicial de cada FUNÇÃO, com só o
 * que a pessoa tem a fazer, em blocos recolhíveis (lembrados por usuário).
 *
 * A função é a do vínculo, ou a do "Ver como" de quem administra. Sem função:
 * quem é gerente ou administrador vê o dia do Gerente; os outros, o do Vendedor.
 */
interface Tarefa {
  id: string;
  title: string;
  due_date: string | null;
  source_kind: string | null;
  contact_id: string | null;
  contato_nome: string | null;
  conversation_id?: string | null;
}
interface LeadComPrazo {
  id: string;
  title: string;
  contact_id: string | null;
  contato_nome: string | null;
  fim_em: string;
  conversation_id?: string | null;
}
interface DadosDoDia {
  funcao: Funcao;
  /** ia.vek v1.7: a mesma visão para SDR e Vendedor. */
  pessoal?: {
    agendamentos: Array<{
      id: string;
      title: string;
      starts_at: string;
      status: string;
      contato_nome: string | null;
      conversation_id: string | null;
    }>;
    leads: Array<{
      id: string;
      title: string;
      etapa: string | null;
      contato_nome: string | null;
      conversation_id?: string | null;
      papel: "dono" | "guardiao";
      dono_nome: string | null;
      proximo_passo_do_dono: { title: string; due_date: string | null } | null;
    }>;
    ligacoes: Tarefa[];
    proximos_passos: Tarefa[];
    propostas: Array<{
      id: string;
      titulo: string;
      status: string;
      total_cents: number;
      moeda: string;
      valid_until: string | null;
      contato_nome: string | null;
    }>;
  };
  /** Só para o SDR: a fila dos leads novos das 72h e a meta do dia. */
  sdr?: {
    leads_novos: LeadComPrazo[];
    agendamentos: { hoje: number; meta: number | null };
  };
  gerente?: {
    leads_novos_hoje: number;
    estourando: LeadComPrazo[];
    atrasos_por_pessoa: Array<{
      user_id: string | null;
      nome: string | null;
      ligacoes: number;
      proximos_passos: number;
      outras: number;
    }>;
    funil_30d: { agendou: number; veio: number; comprou: number };
    conversas_abertas: { com_pessoa: number; com_ia_ou_sem_dono: number };
    perdas_30d: Array<{ motivo: string; total: number }>;
    meta_agendamentos_dia: number | null;
    /** v1.7.6: atendimentos no mesmo horário (null = sem limite). */
    agenda_capacidade_por_horario?: number | null;
    /** v1.7.6: propostas dos vendedores esperando a aprovação do gerente. */
    propostas_aguardando_aprovacao?: Array<{
      id: string;
      titulo: string;
      total_cents: number;
      moeda: string;
      lead_id: string | null;
      pedida_em: string | null;
      vendedor_nome: string | null;
      contato_nome: string | null;
    }>;
    /** v1.7.5: quem tem o quê — as abertas e as feitas nos últimos 7 dias. */
    tarefas_da_equipe?: {
      por_pessoa: Array<{
        user_id: string | null;
        nome: string | null;
        abertas: number;
        atrasadas: number;
        concluidas: number;
      }>;
      itens: Array<TarefaDaEquipe>;
    };
  };
}
interface TarefaDaEquipe extends Tarefa {
  status: string;
  assigned_to: string | null;
  responsavel_nome: string | null;
}

export function funcaoDoDia(funcao: unknown, role: string | null | undefined): Funcao {
  const daTela = funcaoDaTela(funcao); // "apoio" → "gerente" (v1.7.5)
  if (daTela) return daTela;
  const rank = role ? (ROLE_RANK as Record<string, number>)[role] : undefined;
  return rank !== undefined && rank >= ROLE_RANK.manager ? "gerente" : "vendedor";
}

export function chaveDoMeuDia(funcao: Funcao) {
  return ["iavek", "meu-dia", funcao] as const;
}

export function MeuDia() {
  const t = useT();
  const { activeOrg } = useAuth();
  const funcao = funcaoDoDia(activeOrg?.interface_settings?.funcao, activeOrg?.role);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: chaveDoMeuDia(funcao),
    queryFn: () =>
      apiClient
        .get<{ data: DadosDoDia }>(`/api/v1/iavek/meu-dia?funcao=${funcao}`)
        .then((r) => r.data),
    refetchInterval: 60_000,
  });
  // ia.vek v1.9.3: a frase do dia — só na loja, e só para quem TEM a função
  // SDR ou vendedor (o "vendedor" de quem não tem função é só o dia padrão).
  const { lojaDeCarros } = usePerfilDaEmpresa();
  const funcaoGravada = funcaoDaTela(activeOrg?.interface_settings?.funcao);
  const frase =
    lojaDeCarros && funcaoGravada
      ? fraseDoDia(funcaoGravada, new Date(), activeOrg?.timezone ?? "America/Sao_Paulo")
      : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5" data-testid="meu-dia" data-funcao={funcao}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t("Meu dia")}</h1>
          {frase && (
            <p className="mt-0.5 text-sm italic text-muted-foreground" data-testid="frase-do-dia">
              {frase}
            </p>
          )}
        </div>
        <span className="text-sm text-muted-foreground">{t(ROTULO_DA_FUNCAO[funcao])}</span>
      </header>
      {/* ia.vek v1.7.6: pedidos de agendamento (o admin decide; os demais acompanham os seus). */}
      <PedidosDeAgendamento />
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-md border border-border p-4 text-sm">
          <p>{t("Não consegui montar o seu dia agora.")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void refetch()}>
            {t("Tentar de novo")}
          </Button>
        </div>
      ) : data.pessoal ? (
        <DiaPessoal d={data.pessoal} sdr={data.sdr} />
      ) : data.gerente ? (
        <DiaDoGerente d={data.gerente} />
      ) : null}
    </div>
  );
}

// ── peças comuns ──────────────────────────────────────────────────────────────

function Bloco({
  id,
  titulo,
  extra,
  children,
}: {
  id: string;
  titulo: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <SecaoRecolhivel id={`meu-dia:${id}`} titulo={titulo} extra={extra} testId={`bloco-${id}`}>
        <div className="mt-2">{children}</div>
      </SecaoRecolhivel>
    </div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

function Contagem({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-surface-elevated px-2 text-xs text-text-muted tabular-nums">
      {n}
    </span>
  );
}

function useAgora(intervalo = 30_000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), intervalo);
    return () => clearInterval(id);
  }, [intervalo]);
  return agora;
}

const COR = {
  verde: "border-success-fg/30 bg-success-bg text-success-fg",
  ambar: "border-warning-fg/30 bg-warning-bg text-warning-fg",
  vermelho: "border-error-fg/30 bg-error-bg text-error-fg",
} as const;

function Prazo({ fimEm, agora }: { fimEm: string; agora: number }) {
  const t = useT();
  const restante = new Date(fimEm).getTime() - agora;
  const { texto, vencido } = textoDoRestante(restante);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums",
        COR[corDoCronometro(restante)],
      )}
    >
      {vencido ? t("vencido há {time}").replace("{time}", texto) : texto}
    </span>
  );
}

function linkDaConversa(conversationId: string | null | undefined): string | null {
  return conversationId ? `/app/inbox?id=${conversationId}` : null;
}

function Linha({
  href,
  principal,
  secundario,
  direita,
}: {
  href: string | null;
  principal: string;
  secundario?: string | null;
  direita?: ReactNode;
}) {
  const conteudo = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{principal}</span>
        {secundario ? (
          <span className="block truncate text-xs text-muted-foreground">{secundario}</span>
        ) : null}
      </span>
      {direita}
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-elevated"
        >
          {conteudo}
        </Link>
      ) : (
        <div className="flex items-center gap-2 px-2 py-1.5">{conteudo}</div>
      )}
    </li>
  );
}

function quando(iso: string | null, agora: number, t: (s: string) => string): string {
  if (!iso) return t("sem prazo");
  const d = new Date(iso);
  const hora = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.getTime() < agora)
    return t("atrasado · {when}").replace(
      "{when}",
      `${d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })} ${hora}`,
    );
  return hora;
}

function ListaDeTarefas({ tarefas, vazio }: { tarefas: Tarefa[]; vazio: string }) {
  const t = useT();
  const agora = useAgora();
  if (tarefas.length === 0) return <Vazio>{vazio}</Vazio>;
  return (
    <ul className="divide-y divide-border">
      {tarefas.map((x) => {
        const atrasada = x.due_date ? new Date(x.due_date).getTime() < agora : false;
        const codigo = x.source_kind?.startsWith("ligacao:")
          ? x.source_kind.slice("ligacao:".length)
          : null;
        return (
          <Linha
            key={x.id}
            href={linkDaConversa(x.conversation_id)}
            principal={`${codigo ? `${codigo} · ` : ""}${x.title}`}
            secundario={x.contato_nome}
            direita={
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums",
                  atrasada ? "font-medium text-error-fg" : "text-muted-foreground",
                )}
              >
                {quando(x.due_date, agora, t)}
              </span>
            }
          />
        );
      })}
    </ul>
  );
}

// ── SDR e Vendedor (a mesma visão; muda só quais leads) ──────────────────────

function DiaPessoal({
  d,
  sdr,
}: {
  d: NonNullable<DadosDoDia["pessoal"]>;
  sdr?: DadosDoDia["sdr"];
}) {
  const t = useT();
  const agora = useAgora();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sdr ? (
        <>
          <div className="lg:col-span-2">
            <Bloco id="sdr-agendamentos" titulo={t("Agendamentos de hoje")}>
              <div className="flex items-baseline gap-2" data-testid="contador-agendamentos">
                <span className="text-3xl font-semibold tabular-nums">{sdr.agendamentos.hoje}</span>
                <span className="text-sm text-muted-foreground">
                  {sdr.agendamentos.meta
                    ? t("de {goal} da meta").replace("{goal}", String(sdr.agendamentos.meta))
                    : t("sem meta definida")}
                </span>
              </div>
              {sdr.agendamentos.meta ? (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-elevated">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{
                      width: `${Math.min(100, Math.round((sdr.agendamentos.hoje / sdr.agendamentos.meta) * 100))}%`,
                    }}
                  />
                </div>
              ) : null}
            </Bloco>
          </div>
          <div className="lg:col-span-2">
            <Bloco
              id="sdr-leads"
              titulo={t("Leads novos (72h)")}
              extra={<Contagem n={sdr.leads_novos.length} />}
            >
              {sdr.leads_novos.length === 0 ? (
                <Vazio>{t("Nenhum lead novo esperando agendamento.")}</Vazio>
              ) : (
                <ul className="divide-y divide-border">
                  {sdr.leads_novos.map((l) => (
                    <Linha
                      key={l.id}
                      href={linkDaConversa(l.conversation_id)}
                      principal={l.contato_nome ?? l.title}
                      secundario={l.contato_nome ? l.title : null}
                      direita={<Prazo fimEm={l.fim_em} agora={agora} />}
                    />
                  ))}
                </ul>
              )}
            </Bloco>
          </div>
        </>
      ) : null}
      <div className="lg:col-span-2">
        <Bloco id="pessoal-leads" titulo={t("Meus leads")} extra={<Contagem n={d.leads.length} />}>
          {d.leads.length === 0 ? (
            <Vazio>{t("Nenhum lead com você agora.")}</Vazio>
          ) : (
            <ul className="divide-y divide-border" data-testid="meus-leads">
              {d.leads.map((l) => {
                const passo = l.proximo_passo_do_dono;
                const atrasado = passo?.due_date
                  ? new Date(passo.due_date).getTime() < agora
                  : false;
                const guardiao =
                  l.papel === "guardiao"
                    ? [
                        t("Com {who}").replace("{who}", l.dono_nome ?? t("outra pessoa")),
                        passo
                          ? `${t("Próximo passo")}: ${passo.title}${passo.due_date ? ` · ${quando(passo.due_date, agora, t)}` : ""}`
                          : t("Sem próximo passo marcado"),
                      ].join(" · ")
                    : null;
                return (
                  <Linha
                    key={l.id}
                    href={linkDaConversa(l.conversation_id)}
                    principal={l.contato_nome ?? l.title}
                    secundario={guardiao ?? [l.title, l.etapa].filter(Boolean).join(" · ")}
                    direita={
                      l.papel === "guardiao" ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
                            !passo || atrasado
                              ? "border-warning-fg/30 bg-warning-bg text-warning-fg"
                              : "border-border text-text-muted",
                          )}
                          data-testid="selo-guardiao"
                        >
                          {t("Você é o guardião")}
                        </span>
                      ) : l.etapa ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{l.etapa}</span>
                      ) : null
                    }
                  />
                );
              })}
            </ul>
          )}
        </Bloco>
      </div>
      <Bloco
        id="pessoal-agenda"
        titulo={t("Agendamentos de hoje")}
        extra={<Contagem n={d.agendamentos.length} />}
      >
        {d.agendamentos.length === 0 ? (
          <Vazio>{t("Nenhuma visita ou test drive marcado para hoje.")}</Vazio>
        ) : (
          <ul className="divide-y divide-border">
            {d.agendamentos.map((a) => (
              <Linha
                key={a.id}
                href={linkDaConversa(a.conversation_id)}
                principal={a.title}
                secundario={a.contato_nome}
                direita={
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {new Date(a.starts_at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Bloco>
      <Bloco
        id="pessoal-ligacoes"
        titulo={t("Ligações do dia")}
        extra={<Contagem n={d.ligacoes.length} />}
      >
        <ListaDeTarefas tarefas={d.ligacoes} vazio={t("Nenhuma ligação para hoje.")} />
      </Bloco>
      <Bloco
        id="pessoal-passos"
        titulo={t("Próximos passos")}
        extra={<Contagem n={d.proximos_passos.length} />}
      >
        <ListaDeTarefas tarefas={d.proximos_passos} vazio={t("Nenhum próximo passo marcado.")} />
      </Bloco>
      <Bloco
        id="pessoal-propostas"
        titulo={t("Propostas em aberto")}
        extra={<Contagem n={d.propostas.length} />}
      >
        {d.propostas.length === 0 ? (
          <Vazio>{t("Nenhuma proposta em aberto.")}</Vazio>
        ) : (
          <ul className="divide-y divide-border">
            {d.propostas.map((p) => (
              <Linha
                key={p.id}
                href={`/app/proposals/${p.id}`}
                principal={p.titulo}
                secundario={p.contato_nome}
                direita={
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatCents(p.total_cents, p.moeda)}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </Bloco>
    </div>
  );
}

// ── Gerente ───────────────────────────────────────────────────────────────────

function Numero({
  rotulo,
  valor,
  testId,
}: {
  rotulo: string;
  valor: number | string;
  testId?: string;
}) {
  return (
    <div className="rounded-md border border-border p-3 bg-surface/90 backdrop-blur" data-testid={testId}>
      <div className="text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
    </div>
  );
}

function DiaDoGerente({ d }: { d: NonNullable<DadosDoDia["gerente"]> }) {
  const { user, activeOrg } = useAuth();
  const ehAdminDaLoja = (user.is_platform_admin && !user.support) || activeOrg?.role === "admin";
  const t = useT();
  const agora = useAgora();
  const { agendou, veio, comprou } = d.funil_30d;
  const ia = d.conversas_abertas.com_ia_ou_sem_dono;
  const humano = d.conversas_abertas.com_pessoa;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero
          rotulo={t("Leads novos hoje")}
          valor={d.leads_novos_hoje}
          testId="gerente-novos-hoje"
        />
        <Numero rotulo={t("Perto de estourar as 72h")} valor={d.estourando.length} />
        <Numero rotulo={t("Conversas com a IA")} valor={ia} />
        <Numero rotulo={t("Conversas com pessoas")} valor={humano} />
      </div>
      {/* ia.vek v1.8.0 (A2): fora do padrão da loja, por vendedor — sem texto. */}
      <ForaDoPadrao />
      {/* ia.vek v1.8.2: leads sem os campos obrigatórios, por vendedor — sem texto. */}
      <LeadsIncompletos />
      {/* ia.vek v1.8.4: nota dos atendimentos, por vendedor, e as piores. */}
      <NotasDaSemana />
      {d.propostas_aguardando_aprovacao && (
        <Bloco
          id="gerente-propostas-aguardando"
          titulo={t("Propostas aguardando aprovação")}
          extra={<Contagem n={d.propostas_aguardando_aprovacao.length} />}
        >
          {d.propostas_aguardando_aprovacao.length === 0 ? (
            <Vazio>{t("Nenhuma proposta esperando a sua aprovação.")}</Vazio>
          ) : (
            <ul className="divide-y divide-border">
              {d.propostas_aguardando_aprovacao.map((p) => (
                <Linha
                  key={p.id}
                  href={`/app/proposals/${p.id}`}
                  principal={p.contato_nome ?? p.titulo}
                  secundario={`${p.vendedor_nome ?? t("Vendedor")} · ${p.titulo}`}
                  direita={formatCents(p.total_cents, p.moeda)}
                />
              ))}
            </ul>
          )}
        </Bloco>
      )}
      {d.tarefas_da_equipe && <TarefasDaEquipe dados={d.tarefas_da_equipe} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco
          id="gerente-estourando"
          titulo={t("72h estourando (menos de 24h)")}
          extra={<Contagem n={d.estourando.length} />}
        >
          {d.estourando.length === 0 ? (
            <Vazio>{t("Nenhum lead perto de estourar o prazo.")}</Vazio>
          ) : (
            <ul className="divide-y divide-border">
              {d.estourando.map((l) => (
                <Linha
                  key={l.id}
                  href={linkDaConversa(l.conversation_id)}
                  principal={l.contato_nome ?? l.title}
                  secundario={l.contato_nome ? l.title : null}
                  direita={<Prazo fimEm={l.fim_em} agora={agora} />}
                />
              ))}
            </ul>
          )}
        </Bloco>
        <Bloco id="gerente-atrasos" titulo={t("Atrasos por pessoa")}>
          {d.atrasos_por_pessoa.length === 0 ? (
            <Vazio>{t("Ninguém com ligação ou próximo passo atrasado.")}</Vazio>
          ) : (
            <table className="w-full text-sm" data-testid="tabela-atrasos">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">{t("Pessoa")}</th>
                  <th className="py-1 text-right font-medium">{t("Ligações")}</th>
                  <th className="py-1 text-right font-medium">{t("Próximos passos")}</th>
                  <th className="py-1 text-right font-medium">{t("Outras")}</th>
                </tr>
              </thead>
              <tbody>
                {d.atrasos_por_pessoa.map((p) => (
                  <tr key={p.user_id ?? "ninguem"} className="border-t border-border">
                    <td className="py-1.5">
                      {p.nome ?? (p.user_id ? t("Sem nome") : t("Sem responsável"))}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{p.ligacoes}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.proximos_passos}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.outras}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Bloco>
        <Bloco id="gerente-funil" titulo={t("Agendou → veio → comprou (30 dias)")}>
          <div className="grid grid-cols-3 gap-2" data-testid="funil-30d">
            <Numero rotulo={t("Agendou")} valor={agendou} />
            <Numero rotulo={t("Veio")} valor={veio} />
            <Numero rotulo={t("Comprou")} valor={comprou} />
          </div>
          {agendou > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("{came}% vieram · {bought}% compraram")
                .replace("{came}", String(Math.round((veio / agendou) * 100)))
                .replace("{bought}", String(Math.round((comprou / agendou) * 100)))}
            </p>
          )}
        </Bloco>
        <Bloco id="gerente-perdas" titulo={t("Perdas por motivo (30 dias)")}>
          {d.perdas_30d.length === 0 ? (
            <Vazio>{t("Nenhuma perda nos últimos 30 dias.")}</Vazio>
          ) : (
            <ul className="space-y-1.5">
              {d.perdas_30d.map((p) => {
                const maior = d.perdas_30d[0]?.total ?? 1;
                return (
                  <li key={p.motivo} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">
                        {p.motivo === "Sem motivo" ? t("Sem motivo") : p.motivo}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{p.total}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                      <div
                        className="h-full rounded-full bg-error-fg/60"
                        style={{ width: `${Math.round((p.total / maior) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Bloco>
      </div>
      {/* v1.7.6: só o admin define a meta e a capacidade; o gerente VÊ a meta. */}
      {ehAdminDaLoja ? (
        <MetaDeAgendamentos
          meta={d.meta_agendamentos_dia}
          capacidade={d.agenda_capacidade_por_horario ?? null}
        />
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="meta-agendamentos-leitura">
          {t("Meta de agendamentos por dia (para o guardião)")}: {d.meta_agendamentos_dia ?? t("sem meta")}
        </p>
      )}
    </div>
  );
}

type Situacao = "abertas" | "atrasadas" | "concluidas";

/**
 * ia.vek v1.7.5: as TAREFAS DE TODOS, para o gerente controlar — quem tem o
 * quê, o que atrasou e o que foi feito (7 dias), com filtro por vendedor.
 * O resumo por pessoa também filtra: clicar na linha escolhe a pessoa.
 */
function TarefasDaEquipe({
  dados,
}: {
  dados: NonNullable<NonNullable<DadosDoDia["gerente"]>["tarefas_da_equipe"]>;
}) {
  const t = useT();
  const agora = useAgora();
  const [pessoa, setPessoa] = useState<string>("todos");
  const [situacao, setSituacao] = useState<Situacao>("abertas");
  const chave = (u: string | null) => u ?? "ninguem";
  const nomeDe = (p: { user_id: string | null; nome: string | null }) =>
    p.nome ?? (p.user_id ? t("Sem nome") : t("Sem responsável"));

  const daPessoa = dados.itens.filter((x) => pessoa === "todos" || chave(x.assigned_to) === pessoa);
  const atrasada = (x: TarefaDaEquipe) =>
    x.status !== "done" && !!x.due_date && new Date(x.due_date).getTime() < agora;
  const visiveis = daPessoa.filter((x) =>
    situacao === "concluidas"
      ? x.status === "done"
      : situacao === "atrasadas"
        ? atrasada(x)
        : x.status !== "done",
  );
  const conta = {
    abertas: daPessoa.filter((x) => x.status !== "done").length,
    atrasadas: daPessoa.filter(atrasada).length,
    concluidas: daPessoa.filter((x) => x.status === "done").length,
  };
  const ABAS: Array<{ id: Situacao; rotulo: string }> = [
    { id: "abertas", rotulo: t("Abertas") },
    { id: "atrasadas", rotulo: t("Atrasadas") },
    { id: "concluidas", rotulo: t("Concluídas (7 dias)") },
  ];

  return (
    <Bloco
      id="gerente-tarefas-equipe"
      titulo={t("Tarefas da equipe")}
      extra={<Contagem n={conta.abertas} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium" htmlFor="meu-dia-filtro-vendedor">
          {t("Vendedor")}
        </label>
        <select
          id="meu-dia-filtro-vendedor"
          data-testid="tarefas-equipe-vendedor"
          value={pessoa}
          onChange={(e) => setPessoa(e.target.value)}
          className="h-9 min-w-48 rounded-md border bg-background px-3 text-sm"
        >
          <option value="todos">{t("Todos")}</option>
          {dados.por_pessoa.map((p) => (
            <option key={chave(p.user_id)} value={chave(p.user_id)}>
              {nomeDe(p)}
            </option>
          ))}
        </select>
        <div className="flex gap-1" role="tablist">
          {ABAS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={situacao === a.id}
              data-testid={`tarefas-equipe-${a.id}`}
              onClick={() => setSituacao(a.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                situacao === a.id
                  ? "border-accent bg-accent/10 font-medium"
                  : "border-border text-muted-foreground hover:bg-surface-elevated",
              )}
            >
              {a.rotulo} <span className="tabular-nums">{conta[a.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {dados.por_pessoa.length > 0 && (
        <table className="mt-3 w-full text-sm" data-testid="tabela-tarefas-equipe">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">{t("Pessoa")}</th>
              <th className="py-1 text-right font-medium">{t("Abertas")}</th>
              <th className="py-1 text-right font-medium">{t("Atrasadas")}</th>
              <th className="py-1 text-right font-medium">{t("Concluídas (7 dias)")}</th>
            </tr>
          </thead>
          <tbody>
            {dados.por_pessoa.map((p) => (
              <tr
                key={chave(p.user_id)}
                className={cn(
                  "cursor-pointer border-t border-border hover:bg-surface-elevated",
                  pessoa === chave(p.user_id) && "bg-accent/5",
                )}
                onClick={() => setPessoa(chave(p.user_id))}
              >
                <td className="py-1.5">{nomeDe(p)}</td>
                <td className="py-1.5 text-right tabular-nums">{p.abertas}</td>
                <td
                  className={cn(
                    "py-1.5 text-right tabular-nums",
                    p.atrasadas > 0 && "font-medium text-error-fg",
                  )}
                >
                  {p.atrasadas}
                </td>
                <td className="py-1.5 text-right tabular-nums">{p.concluidas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-3" data-testid="lista-tarefas-equipe">
        {visiveis.length === 0 ? (
          <Vazio>
            {situacao === "concluidas"
              ? t("Nenhuma tarefa concluída nos últimos 7 dias.")
              : situacao === "atrasadas"
                ? t("Nenhuma tarefa atrasada.")
                : t("Nenhuma tarefa aberta.")}
          </Vazio>
        ) : (
          <ul className="divide-y divide-border">
            {visiveis.slice(0, 100).map((x) => (
              <Linha
                key={x.id}
                href={
                  linkDaConversa(x.conversation_id) ??
                  (x.contact_id ? `/app/contacts/${x.contact_id}` : null)
                }
                principal={x.title}
                secundario={[x.responsavel_nome ?? t("Sem responsável"), x.contato_nome]
                  .filter(Boolean)
                  .join(" · ")}
                direita={
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      atrasada(x) ? "font-medium text-error-fg" : "text-muted-foreground",
                    )}
                  >
                    {x.status === "done" ? t("concluída") : quando(x.due_date, agora, t)}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </div>
    </Bloco>
  );
}

/** A meta de agendamentos do dia que o SDR vê; o gerente define aqui. */
function MetaDeAgendamentos({ meta, capacidade }: { meta: number | null; capacidade: number | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [valor, setValor] = useState(meta ? String(meta) : "");
  const [cap, setCap] = useState(capacidade ? String(capacidade) : "");
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    try {
      const n = valor.trim() === "" ? null : Math.max(0, Math.floor(Number(valor)));
      const c = cap.trim() === "" ? null : Math.min(1000, Math.max(1, Math.floor(Number(cap))));
      await apiClient.patch("/api/v1/iavek/meu-dia", {
        meta_agendamentos_dia: n,
        agenda_capacidade_por_horario: c,
      });
      toast.success(t("Meta salva."));
      await qc.invalidateQueries({ queryKey: ["iavek", "meu-dia"] });
    } catch {
      toast.error(t("Não consegui salvar a meta."));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3 text-sm">
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">
          {t("Meta de agendamentos por dia (para o guardião)")}
        </span>
        <input
          type="number"
          min={0}
          max={1000}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
          data-testid="meta-agendamentos"
        />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">
          {t("Atendimentos no mesmo horário (vazio = sem limite)")}
        </span>
        <input
          type="number"
          min={1}
          max={1000}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
          data-testid="capacidade-por-horario"
        />
      </label>
      <Button size="sm" variant="outline" disabled={salvando} onClick={() => void salvar()}>
        {salvando ? t("Salvando…") : t("Salvar meta")}
      </Button>
    </div>
  );
}
