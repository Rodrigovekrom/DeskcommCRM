import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { type Role } from "@/lib/auth/types";
import { ESPACO_DA_IA, MENU_DO_GERENTE, funcaoDaTela } from "@/lib/iavek/funcoes";
import {
  Bell,
  BookOpen,
  Brain,
  Buildings,
  CalendarBlank,
  ChartBar,
  ChartLineUp,
  ClipboardText,
  ClockCountdown,
  ClockCounterClockwise,
  FileText,
  Flag,
  FlowArrow,
  Funnel,
  Gauge,
  Inbox,
  Kanban,
  Key,
  Lightbulb,
  ListChecks,
  Lock,
  Megaphone,
  Palette,
  PaperPlaneTilt,
  Phone,
  Plugs,
  PlugsConnected,
  PuzzlePiece,
  Receipt,
  Robot,
  ScalesSimple,
  ShieldCheck,
  Signpost,
  Storefront,
  Tag,
  UserCircle,
  Users,
  UsersThree,
  WebhooksLogo,
} from "@/lib/ui/icons";

import {
  GRUPO_NO_RODAPE,
  NAV_CATALOG,
  NAV_GROUPS,
  type NavMetadata,
  type NavGroup,
  type NavGroupId,
} from "./catalogo";
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { CapacidadeDaOrganizacao } from "@/lib/organizacao/capacidades";

import { destinosDaInterface, type InterfaceSettings } from "./interface";
export { NAV_GROUPS, GRUPO_NO_RODAPE } from "./catalogo";
export type { NavGroup, NavGroupId } from "./catalogo";
const ICONS = {
  Bell,
  BookOpen,
  Brain,
  Buildings,
  CalendarBlank,
  ChartBar,
  ChartLineUp,
  ClipboardText,
  ClockCountdown,
  ClockCounterClockwise,
  FileText,
  Flag,
  FlowArrow,
  Funnel,
  Gauge,
  Inbox,
  Kanban,
  Key,
  Lightbulb,
  ListChecks,
  Lock,
  Megaphone,
  Palette,
  PaperPlaneTilt,
  Phone,
  Plugs,
  PlugsConnected,
  PuzzlePiece,
  Receipt,
  Robot,
  ScalesSimple,
  ShieldCheck,
  Signpost,
  Storefront,
  Tag,
  UserCircle,
  Users,
  UsersThree,
  WebhooksLogo,
};
export interface NavDestination extends Omit<NavMetadata, "icon"> {
  icon: PhosphorIcon;
}
export const NAV_DESTINATIONS: NavDestination[] = NAV_CATALOG.map((d) => ({
  ...d,
  icon: ICONS[d.icon],
}));
/**
 * Único ponto de decisão de permissão da navegação.
 *
 * É o que dispensa os sete `usePermission()` que o Sidebar chamava em sequência
 * — hooks não rodam em laço condicional, então cada permissão exigia sua linha.
 * Como função pura, um `.filter()` resolve todas.
 */
export { canSee } from "./interface";

/** Projeção do sidebar: só o uso diário, agrupado, sem grupo vazio. */
export function sidebarGroups(
  isPlatformAdmin: boolean,
  role: Role | null,
  settings?: InterfaceSettings,
  modulos?: readonly ModuloOpcional[],
  capacidades?: readonly CapacidadeDaOrganizacao[],
): Array<{ group: NavGroup; items: NavDestination[] }> {
  const visible = new Set<string>(
    destinosDaInterface(settings, isPlatformAdmin, role, modulos, capacidades).map((d) => d.href),
  );
  const grupos = NAV_GROUPS.map((group) => ({
    group,
    items: NAV_DESTINATIONS.filter(
      (d) =>
        d.group === group.id &&
        (d.sidebar || (!group.hub && !!settings?.destinos)) &&
        // ia.vek v1.6: "Meu dia" e "Espaço da IA" entram na barra só para quem
        // tem função; sem função, a barra é a de sempre (e a busca os acha).
        // v1.7.5: o Espaço da IA é a exceção — o admin sem função o vê na barra
        // (quem pode vê-lo já foi decidido em `destinosDaInterface`).
        (!d.soComFuncao || Boolean(settings?.funcao) || d.href === ESPACO_DA_IA) &&
        visible.has(d.href),
    ),
  })).filter(
    (g) =>
      g.items.length > 0 ||
      (g.group.hub && NAV_DESTINATIONS.some((d) => d.group === g.group.id && visible.has(d.href))),
  );
  // "apoio" é apelido de gerente (v1.7.5): mesmo desenho.
  if (funcaoDaTela(settings?.funcao) !== "gerente") return grupos;

  // ia.vek v1.7.5: o gerente tem um desenho próprio — dois grupos com nome e
  // rótulos dele, sem hubs. O rodapé (Configurações: perfil e segurança) fica.
  const porHref = new Map(NAV_DESTINATIONS.map((d) => [d.href, d]));
  const doGerente = MENU_DO_GERENTE.map((g) => ({
    group: { id: g.id, label: g.label } as NavGroup,
    items: g.itens.flatMap((i) => {
      const d = porHref.get(i.href);
      return d && visible.has(i.href) ? [{ ...d, label: i.label }] : [];
    }),
  })).filter((g) => g.items.length > 0);
  return [...doGerente, ...grupos.filter((g) => g.group.id === GRUPO_NO_RODAPE)];
}

/**
 * Projeção do hub: TODAS as telas do grupo — inclusive as que já estão no
 * sidebar. O hub é inventário, não sobra; é onde se descobre o que existe.
 *
 * A ordem das seções é a de primeira aparição no registro, então reordenar a
 * jornada é reordenar o array — não há uma segunda lista para manter em sincronia.
 */
export function hubSections(
  group: NavGroupId,
  isPlatformAdmin: boolean,
  role: Role | null,
  settings?: InterfaceSettings,
  modulos?: readonly ModuloOpcional[],
  capacidades?: readonly CapacidadeDaOrganizacao[],
): Array<{ section: string; items: NavDestination[] }> {
  const porSecao = new Map<string, NavDestination[]>();
  const visible = new Set<string>(
    destinosDaInterface(settings, isPlatformAdmin, role, modulos, capacidades).map((d) => d.href),
  );
  for (const d of NAV_DESTINATIONS) {
    if (d.group !== group || !visible.has(d.href)) continue;
    const secao = d.section ?? "";
    const atual = porSecao.get(secao);
    if (atual) atual.push(d);
    else porSecao.set(secao, [d]);
  }
  return [...porSecao.entries()].map(([section, items]) => ({ section, items }));
}

/** Projeção do ⌘K: todo destino visível, do sidebar ou não. */
export function searchable(
  isPlatformAdmin: boolean,
  role: Role | null,
  settings?: InterfaceSettings,
  modulos?: readonly ModuloOpcional[],
  capacidades?: readonly CapacidadeDaOrganizacao[],
): NavDestination[] {
  const visible = new Set<string>(
    destinosDaInterface(settings, isPlatformAdmin, role, modulos, capacidades).map((d) => d.href),
  );
  return NAV_DESTINATIONS.filter((d) => visible.has(d.href));
}
