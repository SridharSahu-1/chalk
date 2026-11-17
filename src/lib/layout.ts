import type { Scene } from "./lesson";

export type Position = { x: number; y: number };

export function layoutNodes(scene: Scene): Map<string, Position> {
  const count = scene.nodes.length;
  // A two-input merge should look like a fork, not a line through another node.
  const merge =
    scene.layout === "flow" &&
    count === 3 &&
    scene.connections.some(
      (edge) => edge.from === scene.nodes[0].id && edge.to === scene.nodes[2].id,
    ) &&
    scene.connections.some(
      (edge) => edge.from === scene.nodes[1].id && edge.to === scene.nodes[2].id,
    );
  return new Map(
    scene.nodes.map((node, index) => {
      if (merge)
        return [node.id, index === 2 ? { x: 630, y: 270 } : { x: 220, y: 150 + index * 240 }];
      if (scene.layout === "cycle") {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
        return [node.id, { x: 450 + Math.cos(angle) * 260, y: 280 + Math.sin(angle) * 145 }];
      }
      if (scene.layout === "axes") {
        return [node.id, { x: 755, y: 90 + index * 74 }];
      }
      const columns = scene.layout === "comparison" ? 2 : Math.min(3, count);
      const rows = Math.ceil(count / columns);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowSize = Math.min(columns, count - row * columns);
      return [
        node.id,
        {
          x: 450 + (column - (rowSize - 1) / 2) * (scene.layout === "comparison" ? 370 : 280),
          y: rows === 1 ? 270 : 150 + row * (rows === 3 ? 145 : 240),
        },
      ];
    }),
  );
}

export function wrapLabel(text: string, limit = 23): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > limit) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let i = 0; i < word.length; i += limit) lines.push(word.slice(i, i + limit));
    } else if ((line + " " + word).trim().length > limit) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

export function edgePath(from: Position, to: Position, compact = false) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const halfWidth = compact ? 100 : 109,
    halfHeight = compact ? 29 : 43;
  const scale = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight, 1);
  const ox = dx / scale,
    oy = dy / scale;
  const start = `${from.x + ox} ${from.y + oy}`;
  const end = `${to.x - ox * 1.08} ${to.y - oy * 1.08}`;
  if (Math.abs(dy) < 25 && Math.abs(dx) > 400) {
    return `M ${start} Q ${(from.x + to.x) / 2} ${from.y - 150} ${end}`;
  }
  return `M ${start} L ${end}`;
}
