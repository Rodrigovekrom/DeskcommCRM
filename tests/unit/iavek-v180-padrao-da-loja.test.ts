import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { avaliarLead, chaveDaMarcacao, lerPadraoDaLoja, PADRAO_INICIAL, type PadraoDaLoja } from "@/lib/iavek/padrao-da-loja";

/** ia.vek v1.8.0 — padrão da loja (A1+A2): conferência SEM IA, só sinaliza. */
const ETAPAS = new Map([["e1", 1000], ["e2", 2000], ["e3", 3000]]);
const AGORA = Date.parse("2026-10-22T12:00:00Z");
const lead = (extra: Partial<Parameters<typeof avaliarLead>[1]> = {}) => ({
  stage_id: "e1",
  assigned_at: "2026-10-22T10:00:00Z",
  created_at: "2026-10-22T09:00:00Z",
  custom_fields: {},
  ...extra,
});
// v1.9.55: o PADRAO_INICIAL do código passou a ser o da CRM-172; os testes da v1.8.0 seguem com o padrão de ANTES, aqui
const PADRAO_V180: PadraoDaLoja = {
  ativo: false,
  itens: [
    { id: "fotos_externas", nome: "6 fotos externas do carro", tipo: "marcacao", papel: "vendedor", minutos: null, minimo_de_fotos: 6, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 24 },
    { id: "fotos_internas", nome: "2 fotos internas do carro", tipo: "marcacao", papel: "vendedor", minutos: null, minimo_de_fotos: 8, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 24 },
    { id: "video_com_nome", nome: "Vídeo com o nome do cliente", tipo: "marcacao", papel: "vendedor", minutos: null, minimo_de_fotos: 0, minimo_de_videos: 1, campo: null, ate_etapa: null, horas: 48 },
    { id: "forma_de_pagamento", nome: "Forma de pagamento definida", tipo: "campo", papel: "vendedor", minutos: null, minimo_de_fotos: 0, minimo_de_videos: 0, campo: "forma_pagamento", ate_etapa: null, horas: 48 },
  ],
};
const ligado: PadraoDaLoja = { ...PADRAO_V180, ativo: true };

describe("o padrão começa DESLIGADO e lê o que o admin gravou", () => {
  it("sem configuração: o padrão inicial, desligado", () => {
    expect(lerPadraoDaLoja({}).ativo).toBe(false);
    // v1.9.55 (CRM-172): o padrão de loja NOVA é o do Rodrigo (sem o item 7), e segue DESLIGADO
    expect(lerPadraoDaLoja({}).itens.map((i) => i.id)).toEqual(["resposta_7_min", "fotos_e_video", "ficha_completa", "visita_agendada", "confirmou_vespera", "video_com_nome"]);
    expect(PADRAO_INICIAL.ativo).toBe(false);
  });
});

describe("avaliação de um lead", () => {
  it("marcação bloqueada enquanto a conversa não tem a mídia mínima", () => {
    const [ext, int, video] = avaliarLead(ligado, lead(), { fotos: 5, videos: 0 }, ETAPAS, AGORA);
    expect(ext!.bloqueio).toBe("faltam 1 foto(s)");
    expect(int!.bloqueio).toBe("faltam 3 foto(s)");
    expect(video!.bloqueio).toBe("falta 1 vídeo(s)");
    expect(ext!.situacao).toBe("pendente");
  });

  it("marcada pelo vendedor = feito; campo preenchido = feito", () => {
    const itens = avaliarLead(
      ligado,
      lead({ custom_fields: { [chaveDaMarcacao("fotos_externas")]: "2026-10-22T11:00:00Z", forma_pagamento: "a_vista" } }),
      { fotos: 8, videos: 0 },
      ETAPAS,
      AGORA,
    );
    expect(itens.find((i) => i.id === "fotos_externas")!.situacao).toBe("feito");
    expect(itens.find((i) => i.id === "forma_de_pagamento")!.situacao).toBe("feito");
  });

  it("prazo vencido (horas depois de assumir, ou passou da etapa) = fora do padrão", () => {
    const tarde = Date.parse("2026-10-24T12:00:00Z");
    expect(avaliarLead(ligado, lead(), { fotos: 0, videos: 0 }, ETAPAS, tarde).every((i) => i.situacao === "fora_do_padrao")).toBe(true);
    const porEtapa: PadraoDaLoja = { ativo: true, itens: [{ ...PADRAO_V180.itens[0]!, horas: null, ate_etapa: "e2" }] };
    expect(avaliarLead(porEtapa, lead({ stage_id: "e1" }), { fotos: 0, videos: 0 }, ETAPAS, AGORA)[0]!.situacao).toBe("pendente");
    expect(avaliarLead(porEtapa, lead({ stage_id: "e2" }), { fotos: 0, videos: 0 }, ETAPAS, AGORA)[0]!.situacao).toBe("fora_do_padrao");
  });
});

describe("cercas do padrão da loja", () => {
  const ler = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const arquivos = [
    "lib/iavek/padrao-da-loja.ts",
    "lib/iavek/padrao-da-loja-servidor.ts",
    "app/api/v1/iavek/padrao/route.ts",
    "app/api/v1/iavek/padrao/leads/route.ts",
    "app/api/v1/iavek/padrao/marcar/route.ts",
    "app/api/v1/iavek/padrao/fora/route.ts",
    "components/iavek/PadraoDoLead.tsx",
  ];
  it("SEM IA e SEM envio: nada de modelo, nada de mandar mensagem", () => {
    for (const f of arquivos) {
      const src = ler(f);
      expect(src, f).not.toMatch(/runModelCall|agent-engine|lib\/ai\/|sendMessage|send_message|\/messages\b.*method:\s*"POST"/);
    }
  });
  it("a marcação é conferida no servidor (dono do lead e mídia mínima)", () => {
    const src = ler("app/api/v1/iavek/padrao/marcar/route.ts");
    expect(src).toMatch(/owner_user_id !== authz\.user\.id && !roleAtLeast\(authz\.org\.role, "manager"\)/);
    expect(src).toMatch(/bloqueio/);
  });
  it("o 'fora do padrão' é de gerente+ e não carrega texto de conversa", () => {
    const src = ler("app/api/v1/iavek/padrao/fora/route.ts");
    expect(src).toMatch(/requireRole\("manager"/);
    expect(src).not.toMatch(/from\("messages"\)|body|conteudo/);
  });
  it("a contagem só lê tipo e conversa da mensagem (nunca o texto)", () => {
    const src = ler("lib/iavek/padrao-da-loja-servidor.ts");
    expect(src).toMatch(/\.select\("conversation_id, type"\)/);
    expect(src).not.toMatch(/select\([^)]*body/);
  });
});
