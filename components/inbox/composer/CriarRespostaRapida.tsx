"use client";
/**
 * ia.vek CRM-244 (Fase 3, teste F): "Criar resposta rápida" direto do "/" do campo da mensagem.
 * A resposta é PESSOAL (de quem cria): `shared: false` na mesma rota da tela de respostas
 * (`POST /api/v1/message-templates`). Criou, ela entra no campo, sem enviar.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import type { MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import { apiClient } from "@/lib/api/client";

export function CriarRespostaRapida({
  open,
  onOpenChange,
  atalhoInicial,
  onCriada,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  atalhoInicial: string;
  onCriada: (t: MessageTemplate) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState(atalhoInicial);
  const [texto, setTexto] = useState("");
  const criar = useMutation({
    mutationFn: () =>
      apiClient.post<{ data: MessageTemplate }>(
        "/api/v1/message-templates",
        { title: titulo.trim(), body: texto.trim(), ...(atalhoInicial.trim() ? { shortcut: atalhoInicial.trim() } : {}), shared: false },
      ),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["message-templates"] });
      onCriada(r.data);
      onOpenChange(false);
    },
    onError: (e) => showApiError(e),
  });
  const pode = titulo.trim().length > 0 && texto.trim().length > 0 && !criar.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialogo-criar-resposta">
        <DialogHeader>
          <DialogTitle>{t("Criar resposta rápida")}</DialogTitle>
        </DialogHeader>
        <label className="text-sm font-medium" htmlFor="resposta-titulo">{t("Nome")}</label>
        <Input id="resposta-titulo" value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} data-testid="resposta-titulo" />
        <label className="text-sm font-medium" htmlFor="resposta-texto">{t("Texto")}</label>
        <Textarea id="resposta-texto" value={texto} maxLength={4096} rows={4} onChange={(e) => setTexto(e.target.value)} data-testid="resposta-texto" />
        <p className="text-xs text-muted-foreground">{t("Só você vê esta resposta.")}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
          <Button disabled={!pode} onClick={() => criar.mutate()} data-testid="salvar-resposta">{t("Salvar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
