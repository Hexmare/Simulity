import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BtNode, BtTree } from "@/sim/types";
import { cn } from "@/lib/utils";

interface Laid {
  id: string;
  x: number;
  y: number;
  node: BtNode;
}

function layout(tree: BtTree): { nodes: Laid[]; width: number; height: number } {
  const nodes: Laid[] = [];
  let maxX = 0;
  const walk = (id: string, depth: number, col: number): number => {
    const node = tree.nodes[id];
    if (!node) return col;
    const kids = node.children ?? (node.child ? [node.child] : []);
    let c = col;
    const childCols: number[] = [];
    for (const k of kids) {
      const used = walk(k, depth + 1, c);
      childCols.push(c);
      c = used + 1;
    }
    const x = kids.length ? (Math.min(...childCols) + Math.max(...childCols)) / 2 : col;
    nodes.push({ id, x, y: depth, node });
    maxX = Math.max(maxX, kids.length ? c - 1 : col);
    return kids.length ? c - 1 : col;
  };
  walk(tree.root, 0, 0);
  const depths = nodes.map((n) => n.y);
  return { nodes, width: maxX + 1, height: (Math.max(0, ...depths) + 1) };
}

export function BtEditor({
  tree,
  runningId,
  onChange,
}: {
  tree: BtTree;
  runningId: string | null;
  onChange: (next: BtTree) => void;
}) {
  const laid = useMemo(() => layout(tree), [tree]);
  const [sel, setSel] = useState<string | null>(tree.root);
  const node = sel ? tree.nodes[sel] : undefined;
  const cw = 148;
  const ch = 56;
  const svgW = Math.max(400, laid.width * cw + 40);
  const svgH = Math.max(180, laid.height * (ch + 36) + 20);

  const addChild = () => {
    if (!node) return;
    const id = `${tree.id}.${Object.keys(tree.nodes).length + 1}`;
    const child: BtNode = { id, type: "action", action: "wait", params: { ticks: 3 }, label: "wait" };
    const next: BtTree = structuredClone(tree);
    next.nodes[id] = child;
    const p = next.nodes[node.id]!;
    if (p.type === "sequence" || p.type === "selector") p.children = [...(p.children ?? []), id];
    else if (p.type === "inverter") p.child = id;
    onChange(next);
    setSel(id);
  };

  const remove = () => {
    if (!node || node.id === tree.root) return;
    const next: BtTree = structuredClone(tree);
    delete next.nodes[node.id];
    for (const n of Object.values(next.nodes)) {
      if (n.children) n.children = n.children.filter((c) => c !== node.id);
      if (n.child === node.id) n.child = undefined;
    }
    onChange(next);
    setSel(tree.root);
  };

  const patch = (partial: Partial<BtNode>) => {
    if (!node) return;
    const next = structuredClone(tree);
    next.nodes[node.id] = { ...next.nodes[node.id]!, ...partial };
    onChange(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-[180px] overflow-auto rounded-md bg-background shadow-[var(--shadow-border)]">
        <svg width={svgW} height={svgH} className="block">
          {laid.nodes.flatMap((n) => {
            const kids = n.node.children ?? (n.node.child ? [n.node.child] : []);
            return kids.map((kid) => {
              const kn = laid.nodes.find((x) => x.id === kid);
              if (!kn) return null;
              const x1 = 20 + n.x * cw + cw / 2;
              const y1 = 12 + n.y * (ch + 36) + ch;
              const x2 = 20 + kn.x * cw + cw / 2;
              const y2 = 12 + kn.y * (ch + 36);
              return <line key={`${n.id}-${kid}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2c2c2f" strokeWidth="1" />;
            });
          })}
          {laid.nodes.map((n) => {
            const x = 20 + n.x * cw;
            const y = 12 + n.y * (ch + 36);
            const active = n.id === runningId;
            const selected = n.id === sel;
            return (
              <g key={n.id} onClick={() => setSel(n.id)} className="cursor-pointer">
                <rect
                  x={x}
                  y={y}
                  width={cw - 12}
                  height={ch}
                  rx="8"
                  fill={active ? "#1f241c" : "#141416"}
                  stroke={selected ? "#c5c8c1" : active ? "#7d9a6e" : "#2c2c2f"}
                  strokeWidth={selected ? 1.5 : 1}
                />
                <text x={x + 10} y={y + 20} fill="#8b8980" fontSize="10" fontFamily="Source Sans 3, sans-serif">
                  {n.node.type}
                </text>
                <text x={x + 10} y={y + 38} fill="#eceae4" fontSize="12" fontFamily="Source Serif 4, serif">
                  {(n.node.label ?? n.node.action ?? n.node.cond ?? n.node.type).slice(0, 16)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {node && (
        <div className="grid gap-2 rounded-md bg-card p-3 shadow-[var(--shadow-border)]">
          <p className="font-display text-sm">{node.label ?? node.id}</p>
          <label className="grid gap-1 text-xs text-muted">
            Type
            <select
              className="h-10 rounded-sm bg-background px-2 text-sm text-foreground shadow-[var(--shadow-border)]"
              value={node.type}
              onChange={(e) => patch({ type: e.target.value as BtNode["type"] })}
            >
              <option value="sequence">sequence</option>
              <option value="selector">selector</option>
              <option value="inverter">inverter</option>
              <option value="condition">condition</option>
              <option value="action">action</option>
            </select>
          </label>
          {(node.type === "action" || node.type === "condition") && (
            <label className="grid gap-1 text-xs text-muted">
              {node.type === "action" ? "Action" : "Condition"}
              <input
                className="h-10 rounded-sm bg-background px-2 text-sm text-foreground shadow-[var(--shadow-border)]"
                value={node.type === "action" ? (node.action ?? "") : (node.cond ?? "")}
                onChange={(e) =>
                  node.type === "action" ? patch({ action: e.target.value, label: e.target.value }) : patch({ cond: e.target.value, label: e.target.value })
                }
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addChild} disabled={node.type === "action" || node.type === "condition"}>
              Add child
            </Button>
            <Button size="sm" variant="ghost" onClick={remove} disabled={node.id === tree.root}>
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TreePicker({
  ids,
  value,
  onChange,
  className,
}: {
  ids: string[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <select
      className={cn("h-10 rounded-sm bg-background px-2 text-sm text-foreground shadow-[var(--shadow-border)]", className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {ids.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  );
}
