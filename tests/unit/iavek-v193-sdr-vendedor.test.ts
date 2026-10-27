import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESTINOS_DA_FUNCAO } from "@/lib/iavek/funcoes";
import { FRASES_DO_SDR, FRASES_DO_VENDEDOR, fraseDoDia } from "@/lib/iavek/frase-do-dia";
import { comLados, etapaDoLado, ladoDaFuncao, lerLados } from "@/lib/iavek/lados-do-funil";
import { limitesDoPeriodo, topMotivos, visaoDosNumeros } from "@/lib/iavek/meus-numeros";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const FUSO = "America/Sao_Paulo";

/** ia.vek v1.9.3 — a visão do SDR e do vendedor (CRM-207/208). */
describe("v1.9.3 — frase do dia", () => {
  it("SDR e vendedor recebem frase da própria lista; gerente não recebe", () => {
    const agora = new Date("2026-10-28T12:00:00Z");
    expect(FRASES_DO_SDR).toContain(fraseDoDia("sdr", agora, FUSO));
    expect(FRASES_DO_SDR).toContain(fraseDoDia("suporte", agora, FUSO));
    expect(FRASES_DO_VENDEDOR).toContain(fraseDoDia("vendedor", agora, FUSO));
    expect(fraseDoDia("gerente", agora, FUSO)).toBeNull();
  });

  it("é a mesma o dia inteiro (no fuso da loja) e muda no dia seguinte", () => {
    const manha = fraseDoDia("vendedor", new Date("2026-10-28T03:30:00Z"), FUSO); // 00:30 em SP
    const noite = fraseDoDia("vendedor", new Date("2026-10-29T02:30:00Z"), FUSO); // 23:30 em SP
    const amanha = fraseDoDia("vendedor", new Date("2026-10-29T03:30:00Z"), FUSO);
    expect(manha).toBe(noite);
    expect(amanha).not.toBe(manha);
  });

  it("o Meu dia mostra a frase só na loja e só para quem tem a função", () => {
    const m = ler("components/iavek/MeuDia.tsx");
    expect(m).toContain("lojaDeCarros && funcaoGravada");
    expect(m).toContain('data-testid="frase-do-dia"');
  });
});

describe("v1.9.3 — Pipeline por função (lados do funil)", () => {
  const SDR = "11111111-1111-4111-8111-111111111111";
  const VEND = "22222222-2222-4222-8222-222222222222";
  const AMBOS = "33333333-3333-4333-8333-333333333333";
  const lados = lerLados({ iavek_lados: { [SDR]: "sdr", [VEND]: "vendedor", [AMBOS]: "ambos" } });

  it("cada lado vê as suas etapas e as dos dois", () => {
    expect(etapaDoLado(lados, SDR, "sdr")).toBe(true);
    expect(etapaDoLado(lados, VEND, "sdr")).toBe(false);
    expect(etapaDoLado(lados, AMBOS, "sdr")).toBe(true);
    expect(etapaDoLado(lados, VEND, "vendedor")).toBe(true);
    expect(etapaDoLado(lados, SDR, "vendedor")).toBe(false);
  });

  it("sem lados configurados, ou sem função, ninguém é recortado (o Pipeline de sempre)", () => {
    expect(etapaDoLado({}, SDR, "vendedor")).toBe(true);
    expect(etapaDoLado(lados, VEND, null)).toBe(true);
    expect(lerLados({ iavek_lados: { x: "qualquer" } })).toEqual({});
    expect(ladoDaFuncao("sdr")).toBe("sdr");
    expect(ladoDaFuncao("suporte")).toBe("sdr");
    expect(ladoDaFuncao("vendedor")).toBe("vendedor");
    expect(ladoDaFuncao("gerente")).toBeNull();
    expect(ladoDaFuncao(undefined)).toBeNull();
  });

  it("gravar os lados não apaga as outras configurações do funil", () => {
    expect(comLados({ lost_reasons: ["x"] }, { [SDR]: "sdr" })).toEqual({ lost_reasons: ["x"], iavek_lados: { [SDR]: "sdr" } });
  });

  it("a carteira do SDR são os leads de que ele é dono OU guardião; a do vendedor, só dono", () => {
    const b = ler("app/api/v1/pipelines/[id]/board/route.ts");
    expect(b).toContain("consultaDeLeads.or(`owner_user_id.eq.${user.id},sdr_user_id.eq.${user.id}`)");
    expect(b).toContain('consultaDeLeads.eq("owner_user_id", user.id)');
    expect(b).toContain("stages: etapasVisiveis,");
  });

  it("o SDR ganha o Pipeline e os Meus números; o vendedor, os Meus números; o gerente não muda", () => {
    expect(DESTINOS_DA_FUNCAO.sdr).toContain("/app/pipeline");
    expect(DESTINOS_DA_FUNCAO.sdr).toContain("/app/meus-numeros");
    expect(DESTINOS_DA_FUNCAO.vendedor).toContain("/app/meus-numeros");
    expect(DESTINOS_DA_FUNCAO.gerente).not.toContain("/app/meus-numeros");
  });
});

describe("v1.9.3 — agenda: o SDR da loja marca direto (decisão B)", () => {
  it("só com a autorização conferida no banco; o compromisso nasce confirmado para o vendedor", () => {
    const r = ler("app/api/v1/iavek/pedidos-de-agendamento/route.ts");
    expect(r).toContain("if (vendedorId) return sdrMarca(authz, input, vendedorId, requestId);");
    expect(r).toMatch(/if \(!\(await sdrMarcaDireto\(admin, orgId, authz\.user\.id\)\)\)/);
    expect(r).toContain("iavekSdrMarcaParaVendedor: true,");
    expect(r).toContain("avisarAdmins: false,");
    expect(r).toContain("avisarVendedorDoAgendamento(admin,");
    const h = ler("app/api/v1/agenda/agendamentos/_handler.ts");
    expect(h).toContain("if (!ctx.iavekSdrMarcaParaVendedor && aOpcaoPodeRecortar(");
    expect(h).toMatch(/ctx\.iavekSdrMarcaParaVendedor\s*\?\s*"confirmed"/);
  });

  it("só a função SDR, só na loja e fora do modo agendamento", () => {
    const s = ler("lib/iavek/sdr-marca-direto.ts");
    expect(s).toContain('if (funcao !== "sdr") return false;');
    expect(s).toContain("return ehLojaDeCarros(perfil) && !perfil.modo_agendamento;");
  });

  it("o vendedor é avisado no sino: o tipo novo está no banco (0595) e no baseline", () => {
    expect(ler("supabase/migrations/20261028010000_0595_iavek_aviso_agendamento_para_voce.sql")).toContain("'agendamento_para_voce'");
    const b = ler("supabase/baseline.sql");
    const ultima = b.slice(b.lastIndexOf("add constraint notificacoes_tipo_check"));
    expect(ultima.slice(0, ultima.indexOf("));"))).toContain("'agendamento_para_voce'");
    expect(ler("components/shell/SinoPessoal.tsx")).toContain('case "agendamento_para_voce":');
    // O lead segue do SDR: o nome do cliente vai no aviso, senão o vendedor lê "um lead".
    expect(ler("lib/iavek/avisos-da-proposta.ts")).toContain("contato_nome: args.contatoNome");
    expect(ler("components/shell/SinoPessoal.tsx")).toContain("n.contato_nome ?? n.lead_titulo ?? doAviso");
  });

  it("o vendedor vê a agenda inteira com os dele em destaque", () => {
    expect(ler("hooks/iavek/useDestaqueDaAgenda.ts")).toContain('=== "vendedor" ? auth.user.id : null');
    expect(ler("components/agenda/GradeDaAgenda.tsx")).toContain("agendamento.responsavelId === destacar");
  });
});

describe("v1.9.3 — Meus números", () => {
  it("o SDR vê números de SDR; os demais, de vendedor", () => {
    expect(visaoDosNumeros("sdr")).toBe("sdr");
    expect(visaoDosNumeros("suporte")).toBe("sdr");
    expect(visaoDosNumeros("vendedor")).toBe("vendedor");
    expect(visaoDosNumeros(null)).toBe("vendedor");
  });

  it("hoje começa à meia-noite da loja; 7 e 30 dias contam para trás", () => {
    const agora = new Date("2026-10-28T15:00:00Z");
    expect(limitesDoPeriodo("hoje", agora, FUSO).inicio.toISOString()).toBe("2026-10-28T03:00:00.000Z");
    expect(limitesDoPeriodo("7d", agora, FUSO).inicio.toISOString()).toBe("2026-10-21T15:00:00.000Z");
  });

  it("motivos de perda: do mais comum ao menos, no máximo 5", () => {
    expect(topMotivos(["Preço", "Muito longe", "Preço", null, " "])).toEqual([
      { motivo: "Preço", total: 2 },
      { motivo: "Muito longe", total: 1 },
    ]);
  });

  it("os números são SÓ de quem está conectado (nenhum parâmetro escolhe a pessoa)", () => {
    const r = ler("app/api/v1/iavek/meus-numeros/route.ts");
    expect(r).toContain("const eu = authz.user.id;");
    expect(r).not.toMatch(/searchParams\.get\("(user|usuario|pessoa)/);
  });
});
