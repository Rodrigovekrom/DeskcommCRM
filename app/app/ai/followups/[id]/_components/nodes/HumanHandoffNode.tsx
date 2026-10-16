"use client";

import type { NodeProps } from "@xyflow/react";

import type { RFNode } from "@/lib/followup/graph-mappers";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUALS, describeNodeConfig } from "./nodeVisuals";
import { NodeCard } from "./NodeCard";

/** O nó `human_handoff` no canvas (ia.vek D3) — "Passar para humano". */
export function HumanHandoffNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.human_handoff}
      label={data.label}
      subtitle={describeNodeConfig("human_handoff", data.config, t)}
      selected={selected}
      errors={data.errors}
    />
  );
}
