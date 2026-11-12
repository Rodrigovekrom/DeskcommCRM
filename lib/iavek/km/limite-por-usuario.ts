/**
 * ia.vek v1.9.47 (nota 5 da Lupa na v1.9.45): o LIMITE da prévia do km por usuário.
 *
 * A prévia (GET /api/v1/iavek/km) gasta a cota grátis do OpenRouteService (geocode + rota) a cada CEP digitado.
 * Sem limite, uma pessoa (ou um script com a sessão dela) esgota a cota do dia da loja inteira, e o km some para
 * todos. O limite é por USUÁRIO, numa janela deslizante: passou dele, a prévia responde "km indisponível agora"
 * (o mesmo texto de sempre na tela; o agendamento segue normal) e o ORS não é chamado.
 *
 * Na memória do processo, de propósito: o app é UM processo, e o pior caso de um reinício é zerar a contagem
 * (o limite volta a valer na hora seguinte). A MARCAÇÃO (que grava o km) não passa por aqui: ela é uma ação real,
 * já limitada pelo próprio agendamento.
 */
export const PREVIAS_DO_KM_POR_HORA = 30;
export const JANELA_DO_KM_MS = 60 * 60_000;
/** Teto de usuários lembrados (a memória nunca cresce sem fim): passou, esquece os mais antigos. */
const TETO_DE_USUARIOS = 5_000;

export class LimiteDoKm {
  private readonly vezes = new Map<string, number[]>();
  constructor(
    private readonly porJanela = PREVIAS_DO_KM_POR_HORA,
    private readonly janelaMs = JANELA_DO_KM_MS,
  ) {}

  /** `true` = pode chamar (e a chamada já foi contada); `false` = passou do limite (nada é contado). */
  tentar(usuarioId: string, agora: number = Date.now()): boolean {
    const desde = agora - this.janelaMs;
    const lista = (this.vezes.get(usuarioId) ?? []).filter((t) => t > desde);
    if (lista.length >= this.porJanela) {
      this.vezes.set(usuarioId, lista);
      return false;
    }
    lista.push(agora);
    this.vezes.delete(usuarioId); // reinsere no fim: o Map fica em ordem do uso mais recente
    this.vezes.set(usuarioId, lista);
    while (this.vezes.size > TETO_DE_USUARIOS) {
      const maisAntigo = this.vezes.keys().next().value;
      if (maisAntigo === undefined) break;
      this.vezes.delete(maisAntigo);
    }
    return true;
  }
}

/** O limite do processo (um só para todas as requisições). */
export const limiteDoKm = new LimiteDoKm();
