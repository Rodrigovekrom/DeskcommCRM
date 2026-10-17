"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import { useUploadMedia } from "@/hooks/inbox/useUploadMedia";
import { useCreateNote } from "@/hooks/inbox/useCreateNote";
import {
  CHAVE_DAS_FOTOS_DA_TROCA,
  LEGENDA_DA_FOTO_DA_TROCA,
  MAX_FOTOS_DA_TROCA,
  alternarRef,
  refsMarcadas,
  type FotoDaTroca,
} from "@/lib/iavek/fotos-da-troca";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ia.vek v1.5 (parte C): a galeria das fotos do CARRO DA TROCA, na ficha.
 *
 * - "Escolher da conversa": as imagens que o cliente (ou a equipe) mandou nas
 *   conversas do contato; um clique marca ou desmarca;
 * - "Subir foto": vira anexo de nota interna ("Foto do carro da troca") na
 *   conversa aberta e já entra marcada;
 * - a marcação fica no lead (`custom_fields.troca_fotos`).
 *
 * As fotos seguem a retenção de mídia da organização: a que venceu aparece como
 * "foto expirada" (decisão do Rodrigo, 17/10/2026).
 */
export function chaveDasFotosDaTroca(contactId: string | null) {
  return ["iavek", "fotos-da-troca", contactId] as const;
}

export function FotosDaTroca({
  contactId,
  conversationId,
  lead,
  readonly,
  onSalvo,
}: {
  contactId: string | null;
  conversationId: string;
  lead: { id: string; custom_fields: Record<string, unknown> | null } | null;
  readonly?: boolean;
  onSalvo: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const upload = useUploadMedia();
  const criarNota = useCreateNote();
  const arquivo = useRef<HTMLInputElement>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // Marcação otimista: a ficha só recarrega depois do PATCH.
  const [marcadasLocais, setMarcadasLocais] = useState<string[] | null>(null);

  const { data: fotos, isError } = useQuery({
    queryKey: chaveDasFotosDaTroca(contactId),
    queryFn: () =>
      apiClient
        .get<{ data: { fotos: FotoDaTroca[] } }>(`/api/v1/contacts/${contactId}/fotos-da-troca`)
        .then((r) => r.data.fotos),
    enabled: Boolean(contactId),
    staleTime: 30_000,
  });

  if (!lead) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t("Crie um negócio para guardar as fotos do carro da troca.")}
      </p>
    );
  }

  const marcadas = marcadasLocais ?? refsMarcadas(lead.custom_fields);
  const porRef = new Map((fotos ?? []).map((f) => [f.ref, f]));
  const cheia = marcadas.length >= MAX_FOTOS_DA_TROCA;
  const daTroca = marcadas.map((ref) => porRef.get(ref) ?? null);

  async function gravar(proximas: string[]) {
    if (!lead) return;
    setMarcadasLocais(proximas);
    setSalvando(true);
    try {
      await apiClient.patch(`/api/v1/leads/${lead.id}`, {
        custom_fields: { [CHAVE_DAS_FOTOS_DA_TROCA]: proximas },
      });
      onSalvo();
    } catch {
      setMarcadasLocais(null);
      toast.error(t("Não consegui salvar as fotos da troca."));
    } finally {
      setSalvando(false);
    }
  }

  async function subir(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    setSalvando(true);
    const novas: string[] = [];
    try {
      for (const f of Array.from(lista)) {
        if (!f.type.startsWith("image/")) continue;
        const anexo = await upload.mutateAsync({ conversationId, file: f, destino: "nota" });
        const nota = await criarNota.mutateAsync({
          conversation_id: conversationId,
          body: t(LEGENDA_DA_FOTO_DA_TROCA),
          anexo: {
            storage_path: anexo.storage_path,
            media_mime: anexo.media_mime,
            media_size_bytes: anexo.media_size_bytes,
          },
        });
        novas.push(`n:${nota.data.id}`);
      }
    } catch {
      // o toast de erro já saiu pelo hook; grava o que subiu até aqui.
    } finally {
      setSalvando(false);
      if (arquivo.current) arquivo.current.value = "";
    }
    if (novas.length > 0) {
      await qc.invalidateQueries({ queryKey: chaveDasFotosDaTroca(contactId) });
      let proximas = marcadas;
      for (const r of novas) if (!proximas.includes(r)) proximas = alternarRef(proximas, r);
      await gravar(proximas);
    }
  }

  return (
    <div className="mt-2 space-y-2" data-testid="fotos-da-troca">
      {daTroca.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("Nenhuma foto do carro da troca ainda.")}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {daTroca.map((f, i) => (
            <li key={marcadas[i]}>
              <Miniatura foto={f} />
            </li>
          ))}
        </ul>
      )}

      {!readonly && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            aria-expanded={escolhendo}
            onClick={() => setEscolhendo((v) => !v)}
          >
            {escolhendo ? t("Concluir") : t("Escolher da conversa")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={salvando || cheia}
            onClick={() => arquivo.current?.click()}
          >
            {salvando ? t("Salvando…") : t("Subir foto")}
          </Button>
          <input
            ref={arquivo}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            data-testid="subir-foto-da-troca"
            onChange={(e) => void subir(e.target.files)}
          />
        </div>
      )}

      {escolhendo && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {t("Toque nas fotos que são do carro da troca.")}
          </p>
          {isError ? (
            <p className="text-xs text-error-fg">{t("Não consegui ler as fotos das conversas.")}</p>
          ) : (fotos ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("Nenhuma foto nas conversas deste contato.")}
            </p>
          ) : (
            <ul className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto">
              {(fotos ?? []).map((f) => {
                const marcada = marcadas.includes(f.ref);
                return (
                  <li key={f.ref}>
                    <button
                      type="button"
                      aria-pressed={marcada}
                      disabled={salvando}
                      onClick={() => void gravar(alternarRef(marcadas, f.ref))}
                      className={cn(
                        "block w-full rounded-md ring-offset-1",
                        marcada ? "ring-2 ring-accent" : "opacity-80 hover:opacity-100",
                      )}
                    >
                      <Miniatura foto={f} link={false} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Miniatura({ foto, link = true }: { foto: FotoDaTroca | null; link?: boolean }) {
  const t = useT();
  const [falhou, setFalhou] = useState(false);
  if (!foto || foto.expirada || falhou) {
    return (
      <div
        className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border p-1 text-center text-[10px] text-muted-foreground"
        data-testid="foto-expirada"
      >
        {t("foto expirada")}
      </div>
    );
  }
  const imagem = (
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada de curta duração, não otimizável
    <img
      src={foto.url}
      alt={t("Foto do carro da troca")}
      loading="lazy"
      onError={() => setFalhou(true)}
      className="aspect-square w-full rounded-md border border-border object-cover"
    />
  );
  if (!link) return imagem;
  return (
    <a
      href={foto.url}
      target="_blank"
      rel="noreferrer"
      title={t(foto.de === "cliente" ? "Enviada pelo cliente" : "Enviada pela equipe")}
    >
      {imagem}
    </a>
  );
}
