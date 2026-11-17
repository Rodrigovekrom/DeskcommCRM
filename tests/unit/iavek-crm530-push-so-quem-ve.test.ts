/**
 * ia.vek CRM-530 (Rodrigo 17/11, aprovado): o aviso no celular vai SÓ a quem pode VER aquilo de que ele fala, e só a membro
 * ATIVO. De fábrica, a tela de bloqueio mostra "Nova mensagem de <nome>", sem o texto. Mais o botão de teste e o convite.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABELAS_QUE_DECIDEM, gerenciaInscrita, inscritosQueVeem } from "@/lib/notifications/quem-ve";

/** Um pool falso: a 1ª consulta (os candidatos) devolve `candidatos`; cada "exists" devolve se aquele `sub` vê. */
function poolFalso(candidatos: string[], veem: Set<string>, falhaEm?: string, rollbackFalha = false) {
  const sqls: string[] = [];
  let subAtual = "";
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      sqls.push(sql);
      if (sql.includes("set_config('request.jwt.claims'")) subAtual = String(params?.[1] ?? "");
      if (sql === "rollback" && rollbackFalha) throw new Error("conexão caiu no rollback");
      if (sql.includes("select exists")) {
        if (subAtual === falhaEm) throw new Error("falhou");
        return { rows: [{ ve: veem.has(subAtual) }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async () => ({ rows: candidatos.map((user_id) => ({ user_id })) })),
    connect: vi.fn(async () => client),
  };
  return { pool: pool as never, client, sqls };
}

describe("CRM-530: quem VÊ decide quem recebe (a PRÓPRIA policy, por inscrito)", () => {
  it("só os inscritos ativos que a RLS deixa ver a linha; UMA transação por mensagem (Lupa 183222), com prazo, desfeita", async () => {
    const f = poolFalso(["a", "b", "c"], new Set(["a", "c"]));
    expect(await inscritosQueVeem(f.pool, "org", "conversations", "conv-1")).toEqual(["a", "c"]);
    expect(f.sqls.filter((q) => q === "begin")).toHaveLength(1);
    expect(f.sqls.filter((q) => q === "set local role authenticated")).toHaveLength(1);
    expect(f.sqls.filter((q) => q.startsWith("set local statement_timeout"))).toHaveLength(1);
    expect(f.sqls.filter((q) => q.includes("set_config('request.jwt.claims'"))).toHaveLength(3);
    expect(f.sqls.filter((q) => q === "rollback")).toHaveLength(1);
    expect(f.sqls.some((q) => /^\s*commit/i.test(q))).toBe(false);
    expect(f.sqls.find((q) => q.includes("select exists"))).toContain("from public.conversations where id = $1");
    expect(f.client.release).toHaveBeenCalled();
  });

  it("os candidatos são só membros ATIVOS com inscrição (aceito e não revogado)", async () => {
    const f = poolFalso([], new Set());
    await inscritosQueVeem(f.pool, "org", "conversations", "conv-1");
    const sql = String((f.pool as unknown as { query: { mock: { calls: unknown[][] } } }).query.mock.calls[0]![0]);
    expect(sql).toContain("uo.revoked_at is null");
    expect(sql).toContain("uo.accepted_at is not null");
    expect(sql).toContain("public.push_subscriptions");
  });

  it("um erro no meio (ou o prazo) FECHA: ninguém recebe, nem quem já tinha respondido 'vê', e vai ao log", async () => {
    const f = poolFalso(["a", "b"], new Set(["a", "b"]), "b");
    const log = vi.fn();
    expect(await inscritosQueVeem(f.pool, "org", "conversations", "conv-1", log)).toEqual([]);
    expect(log).toHaveBeenCalledWith("push_quem_ve_falhou", expect.objectContaining({ tabela: "conversations", candidatos: 2 }));
  });

  it("o rollback e o release acontecem SEMPRE, inclusive depois de um erro no meio", async () => {
    const f = poolFalso(["a", "b"], new Set(["a"]), "b");
    await inscritosQueVeem(f.pool, "org", "conversations", "conv-1");
    expect(f.sqls[f.sqls.length - 1]).toBe("rollback");
    expect(f.client.release).toHaveBeenCalledTimes(1);
  });

  it("o ROLLBACK que falha DESTRÓI a conexão (release com erro), em vez de devolvê-la ao pool como a última pessoa", async () => {
    const f = poolFalso(["a"], new Set(["a"]), undefined, true);
    const log = vi.fn();
    expect(await inscritosQueVeem(f.pool, "org", "conversations", "conv-1", log)).toEqual([]);
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect((f.client.release.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Error);
    expect(log).toHaveBeenCalledWith("push_quem_ve_rollback_falhou", expect.anything());
  });

  it("o rollback que dá certo devolve a conexão ao pool normalmente (release sem erro)", async () => {
    const f = poolFalso(["a"], new Set(["a"]));
    await inscritosQueVeem(f.pool, "org", "conversations", "conv-1");
    expect((f.client.release.mock.calls[0] as unknown[])[0]).toBeUndefined();
  });

  it("o PRAZO TOTAL da transação (3 s) estourado no meio: FECHA (ninguém) e vai ao log", async () => {
    const f = poolFalso(["a", "b", "c"], new Set(["a", "b", "c"]));
    let t = 0;
    const agora = () => (t += 1200); // cada leitura do relógio avança 1,2 s: o 3º candidato passa do prazo
    const log = vi.fn();
    expect(await inscritosQueVeem(f.pool, "org", "conversations", "conv-1", log, agora)).toEqual([]);
    expect(log).toHaveBeenCalledWith("push_quem_ve_falhou", expect.objectContaining({ erro: expect.stringContaining("prazo total") }));
    expect(f.sqls[f.sqls.length - 1]).toBe("rollback");
  });

  it("sem conexão no pool: ninguém recebe, sem lançar", async () => {
    const f = poolFalso(["a"], new Set(["a"]));
    (f.pool as unknown as { connect: () => Promise<never> }).connect = async () => { throw new Error("pool cheio"); };
    expect(await inscritosQueVeem(f.pool, "org", "conversations", "conv-1")).toEqual([]);
  });

  it("tabela fora da lista fechada: ninguém, e nada é consultado (o nome entra no SQL)", async () => {
    const f = poolFalso(["a"], new Set(["a"]));
    expect(await inscritosQueVeem(f.pool, "org", "users; drop table x", "id")).toEqual([]);
    expect(await inscritosQueVeem(f.pool, "org", "auth_users", "id")).toEqual([]);
    expect((f.pool as unknown as { connect: { mock: { calls: unknown[] } } }).connect.mock.calls).toHaveLength(0);
  });

  it("a lista fechada é a conversa + as tabelas que a Central abre", () => {
    expect(TABELAS_QUE_DECIDEM.has("conversations")).toBe(true);
    expect(TABELAS_QUE_DECIDEM.has("crm_leads")).toBe(true);
    expect(TABELAS_QUE_DECIDEM.has("crm_proposals")).toBe(true);
  });

  it("a gerência inscrita (para o aviso sem referência): só admin e manager, ativos", async () => {
    const f = poolFalso(["g1"], new Set());
    expect(await gerenciaInscrita(f.pool, "org")).toEqual(["g1"]);
    const sql = String((f.pool as unknown as { query: { mock: { calls: unknown[][] } } }).query.mock.calls[0]![0]);
    expect(sql).toContain("uo.role in ('admin', 'manager')");
    expect(sql).toContain("uo.revoked_at is null");
  });
});

describe("CRM-530: a CERCA, nenhuma mensagem nem aviso da Central volta a ir à org inteira", () => {
  it("o push.handler não chama enviarPushDaOrg", () => {
    const fonte = readFileSync(join(process.cwd(), "lib/notifications/push.handler.ts"), "utf8");
    expect(fonte).not.toMatch(/enviarPushDaOrg\s*\(/);
    expect(fonte).toContain('destinosQueVeem(row.organization_id, "conversations", conversationId)');
  });

  it("fora do web_push.ts, ninguém em lib/ ou app/ chama enviarPushDaOrg", () => {
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) {
          if (nome !== "node_modules") varrer(p);
        } else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !p.endsWith(join("notifications", "web_push.ts"))) {
          if (/enviarPushDaOrg\s*\(/.test(readFileSync(p, "utf8"))) achados.push(p);
        }
      }
    };
    varrer(join(process.cwd(), "lib"));
    varrer(join(process.cwd(), "app"));
    expect(achados).toEqual([]);
  });

  it("o envio a UMA pessoa confere o membro ativo antes de mandar", () => {
    const fonte = readFileSync(join(process.cwd(), "lib/notifications/web_push.ts"), "utf8");
    const corpo = fonte.slice(fonte.indexOf("export async function enviarPushAoUsuario"));
    expect(corpo.indexOf('.is("revoked_at", null)')).toBeGreaterThan(0);
    expect(corpo.indexOf('.not("accepted_at", "is", null)')).toBeGreaterThan(0);
    expect(corpo.indexOf('.is("revoked_at", null)')).toBeLessThan(corpo.indexOf('.from("push_subscriptions")'));
  });
});

describe("CRM-530: o roteamento no handler", () => {
  beforeEach(() => vi.resetModules());

  async function handlerCom(opts: { item?: Record<string, unknown> | null; settings?: unknown }) {
    const quemVe = { inscritosQueVeem: vi.fn(async () => ["u-ve"]), gerenciaInscrita: vi.fn(async () => ["u-gerente"]) };
    const envio = {
      enviarPushAosUsuarios: vi.fn(async () => ({ sent: 1, gone: 0 })),
      enviarPushAoUsuario: vi.fn(async () => ({ sent: 1, gone: 0 })),
      enviarPushDaOrg: vi.fn(async () => ({ sent: 9, gone: 0 })),
    };
    vi.doMock("@/lib/notifications/quem-ve", () => quemVe);
    vi.doMock("@/lib/notifications/web_push", () => envio);
    vi.doMock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true }));
    vi.doMock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
    vi.doMock("@/lib/channels/desativado", () => ({ canalDoEventoDesativado: async () => false }));
    vi.doMock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "Loja" }) }));
    vi.doMock("@/lib/notifications/push-dos-avisos", () => ({
      pushDoAvisoDaCentral: async () => ({ title: "Aviso", body: "b", tag: "t", href: "/app/central" }),
    }));
    const assinar = vi.fn(async () => ({ data: { signedUrl: "https://assinada/foto" } }));
    const linhas: Record<string, unknown> = {
      contacts: { display_name: "Maria Souza", is_personal: false, is_anonymized: false, avatar_storage_path: "org/foto.jpg" },
      organizations: { settings: opts.settings ?? {} },
      agent_inbox_items: opts.item ?? null,
    };
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (t: string) => {
          const q: Record<string, unknown> = {};
          q.select = () => q;
          q.eq = () => q;
          q.maybeSingle = async () => ({ data: linhas[t] ?? null, error: null });
          return q;
        },
        storage: { from: () => ({ createSignedUrl: assinar }) },
      }),
    }));
    const { webPushInboundHandler } = await import("@/lib/notifications/push.handler");
    return { webPushInboundHandler, quemVe, envio, assinar };
  }

  const linha = (event_type: string, payload: Record<string, unknown>) => ({
    id: "e", organization_id: "org1", event_type, entity_kind: "message", entity_id: "item-1",
    payload, metadata: {}, consumed_by: [], attempts: 0,
  });

  it("mensagem nova: SÓ a quem vê a conversa, com o título 'Nova mensagem de <nome>' e sem o texto", async () => {
    const h = await handlerCom({});
    await h.webPushInboundHandler.handle(
      linha("message.received", { conversation_id: "conv-1", contact_id: "ct-1", body_preview: "meu CPF é 123", type: "text" }) as never,
    );
    expect(h.quemVe.inscritosQueVeem).toHaveBeenCalledWith(expect.anything(), "org1", "conversations", "conv-1");
    expect(h.envio.enviarPushDaOrg).not.toHaveBeenCalled();
    const [, destinos, payload] = h.envio.enviarPushAosUsuarios.mock.calls[0] as unknown as [string, string[], { title: string; body: string }];
    expect(destinos).toEqual(["u-ve"]);
    expect(payload.title).toBe("Nova mensagem de Maria Souza");
    expect(JSON.stringify(payload)).not.toContain("CPF");
  });

  it("'so_nome' (de fábrica): a URL assinada da foto NEM é gerada; 'completo': é gerada e vai no aviso", async () => {
    const h = await handlerCom({});
    await h.webPushInboundHandler.handle(linha("message.received", { conversation_id: "c", contact_id: "ct", body_preview: "oi", type: "text" }) as never);
    expect(h.assinar).not.toHaveBeenCalled();
    vi.resetModules();
    const c = await handlerCom({ settings: { iavek: { push: { conteudo: "completo" } } } });
    await c.webPushInboundHandler.handle(linha("message.received", { conversation_id: "c", contact_id: "ct", body_preview: "oi", type: "text" }) as never);
    expect(c.assinar).toHaveBeenCalledTimes(1);
    expect((c.envio.enviarPushAosUsuarios.mock.calls[0] as unknown as unknown[])[2]).toMatchObject({ icon: "https://assinada/foto", body: "oi" });
  });

  it("aviso da Central com a config 'nada': genérico, sem o título do aviso", async () => {
    const h = await handlerCom({ item: { ref_kind: "conversation", ref_id: "conv-9" }, settings: { iavek: { push: { conteudo: "nada" } } } });
    await h.webPushInboundHandler.handle(linha("central.aviso_criado", { item_id: "item-1" }) as never);
    expect((h.envio.enviarPushAosUsuarios.mock.calls[0] as unknown as unknown[])[2]).toMatchObject({ title: "Novo aviso na Central" });
  });

  it("aviso da Central que referencia uma conversa: SÓ a quem vê aquela conversa", async () => {
    const h = await handlerCom({ item: { ref_kind: "conversation", ref_id: "conv-9" } });
    await h.webPushInboundHandler.handle(linha("central.aviso_criado", { item_id: "item-1" }) as never);
    expect(h.quemVe.inscritosQueVeem).toHaveBeenCalledWith(expect.anything(), "org1", "conversations", "conv-9");
    expect((h.envio.enviarPushAosUsuarios.mock.calls[0] as unknown as unknown[])[1]).toEqual(["u-ve"]);
    expect(h.envio.enviarPushDaOrg).not.toHaveBeenCalled();
  });

  it("aviso da Central que referencia um negócio: pela RLS de crm_leads", async () => {
    const h = await handlerCom({ item: { ref_kind: "lead", ref_id: "lead-3" } });
    await h.webPushInboundHandler.handle(linha("central.aviso_criado", { item_id: "item-1" }) as never);
    expect(h.quemVe.inscritosQueVeem).toHaveBeenCalledWith(expect.anything(), "org1", "crm_leads", "lead-3");
  });

  it("aviso da Central com referência FORA da lista: FECHA na gerência ativa inscrita, nunca a org inteira", async () => {
    const h = await handlerCom({ item: { ref_kind: "tabela_que_nao_existe", ref_id: "x-1" } });
    await h.webPushInboundHandler.handle(linha("central.aviso_criado", { item_id: "item-1" }) as never);
    expect(h.quemVe.inscritosQueVeem).not.toHaveBeenCalled();
    expect(h.quemVe.gerenciaInscrita).toHaveBeenCalled();
    expect((h.envio.enviarPushAosUsuarios.mock.calls[0] as unknown as unknown[])[1]).toEqual(["u-gerente"]);
    expect(h.envio.enviarPushDaOrg).not.toHaveBeenCalled();
  });

  it("aviso da Central SEM referência (ex.: a IA sem saldo): à gerência ativa inscrita", async () => {
    const h = await handlerCom({ item: { ref_kind: null, ref_id: null } });
    await h.webPushInboundHandler.handle(linha("central.aviso_criado", { item_id: "item-1" }) as never);
    expect(h.quemVe.inscritosQueVeem).not.toHaveBeenCalled();
    expect(h.quemVe.gerenciaInscrita).toHaveBeenCalled();
    expect((h.envio.enviarPushAosUsuarios.mock.calls[0] as unknown as unknown[])[1]).toEqual(["u-gerente"]);
  });
});

describe("CRM-530: a lista fechada das referências da Central (Lupa 185335)", () => {
  it("toda referência que a Central manda ao celular (push-dos-avisos) está na lista que decide quem vê; quebra com tipo novo", async () => {
    const { REFERENCIAS_DE_AVISO } = await import("@/lib/ai/inbox-destino");
    const fonte = readFileSync(join(process.cwd(), "lib/notifications/push-dos-avisos.ts"), "utf8");
    const usadas = [...new Set([...fonte.matchAll(/ref_kind === "([a-z_]+)"/g)].map((m) => m[1]!))];
    expect(usadas.length).toBeGreaterThan(0);
    const fora = usadas.filter((k) => !(k in REFERENCIAS_DE_AVISO));
    expect(fora).toEqual([]);
    for (const k of usadas) {
      expect(TABELAS_QUE_DECIDEM.has((REFERENCIAS_DE_AVISO as Record<string, { tabela: string }>)[k]!.tabela)).toBe(true);
    }
  });
});

describe("CRM-530: o botão 'Enviar um teste'", () => {
  beforeEach(() => vi.resetModules());

  it("manda SÓ à própria pessoa da sessão, e o 2º em menos de 1 minuto dá 429", async () => {
    const enviar = vi.fn(async () => ({ sent: 2, gone: 0 }));
    vi.doMock("@/lib/notifications/web_push", () => ({ enviarPushAoUsuario: enviar }));
    vi.doMock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true }));
    vi.doMock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
    vi.doMock("@/lib/auth/require-role", () => ({
      requireRole: async () => ({ ok: true, user: { id: "eu", idioma: "pt" }, org: { orgId: "org1" } }),
    }));
    const { POST } = await import("@/app/api/v1/notifications/push/teste/route");
    const r1 = await POST();
    expect(r1.status).toBe(200);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect((enviar.mock.calls[0] as unknown[])[0]).toBe("org1");
    expect((enviar.mock.calls[0] as unknown[])[1]).toBe("eu");
    const r2 = await POST();
    expect(r2.status).toBe(429);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe("CRM-530: o convite reconhece o iPhone fora da Tela de Início", () => {
  it("iPhone no Safari comum: sim; Android: não", async () => {
    const { iphoneSemInstalar } = await import("@/components/notifications/ConviteDoCelular");
    const ua = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
    Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", configurable: true });
    window.matchMedia = (() => ({ matches: false })) as never;
    expect(iphoneSemInstalar()).toBe(true);
    Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 14) Chrome/120", configurable: true });
    expect(iphoneSemInstalar()).toBe(false);
    if (ua) Object.defineProperty(window.navigator, "userAgent", ua);
  });
});
