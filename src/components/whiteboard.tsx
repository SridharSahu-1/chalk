"use client";

import { useId } from "react";
import type { Lesson } from "@/lib/lesson";
import { boardAt } from "@/lib/lesson";
import { edgePath, layoutNodes, wrapLabel } from "@/lib/layout";

export function Whiteboard({
  lesson,
  index,
  onSelect,
}: {
  lesson: Lesson;
  index: number;
  onSelect: (label: string) => void;
}) {
  const { scene, visible, highlighted } = boardAt(lesson, index);
  const positions = layoutNodes(scene);
  const marker = useId().replace(/:/g, "");
  const axes = scene.layout === "axes";
  const minX = Math.min(0, ...scene.points.map((point) => point.x));
  const maxX = Math.max(1, ...scene.points.map((point) => point.x));
  const minY = Math.min(0, ...scene.points.map((point) => point.y));
  const maxY = Math.max(1, ...scene.points.map((point) => point.y));
  const px = (x: number) => 95 + ((x - minX) / (maxX - minX)) * 475;
  const py = (y: number) => 425 - ((y - minY) / (maxY - minY)) * 330;

  return (
    <svg
      className="lesson-svg"
      viewBox="0 0 900 530"
      role="group"
      aria-label={`${scene.title}. Select a concept to ask about it.`}
    >
      <defs>
        <marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </marker>
      </defs>
      {axes ? (
        <g className="plot" aria-label={`${scene.yLabel} versus ${scene.xLabel}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="95"
                y1={95 + fraction * 330}
                x2="570"
                y2={95 + fraction * 330}
                stroke="#e8e6f1"
              />
              <text
                x="82"
                y={py(minY + fraction * (maxY - minY)) + 5}
                textAnchor="end"
                fontSize="13"
                fill="#777185"
              >
                {+(minY + fraction * (maxY - minY)).toFixed(1)}
              </text>
              <text
                x={px(minX + fraction * (maxX - minX))}
                y="448"
                textAnchor="middle"
                fontSize="13"
                fill="#777185"
              >
                {+(minX + fraction * (maxX - minX)).toFixed(1)}
              </text>
            </g>
          ))}
          <line x1={px(0)} y1="435" x2={px(0)} y2="80" stroke="#9990ac" />
          <line x1="85" y1={py(0)} x2="590" y2={py(0)} stroke="#9990ac" />
          <text x="330" y="480" textAnchor="middle" className="axis-label">
            {scene.xLabel}
          </text>
          <text
            transform="translate(28,260) rotate(-90)"
            textAnchor="middle"
            className="axis-label"
          >
            {scene.yLabel}
          </text>
          <polyline
            points={scene.points.map((point) => `${px(point.x)},${py(point.y)}`).join(" ")}
            fill="none"
            stroke="#7661cf"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          {scene.points.map((point, i) => (
            <circle key={i} cx={px(point.x)} cy={py(point.y)} r="4" fill="#7661cf" />
          ))}
        </g>
      ) : null}
      {scene.connections
        .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
        .map((edge, i) => {
          const from = positions.get(edge.from)!,
            to = positions.get(edge.to)!;
          return (
            <g key={`${scene.id}-edge-${i}`} className="board-reveal" style={{ color: "#a99dce" }}>
              <path
                d={edgePath(from, to, axes)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                markerEnd={`url(#${marker})`}
              />
              <title>{`${edge.from} to ${edge.to}${edge.label ? `: ${edge.label}` : ""}`}</title>
              {edge.label && scene.layout !== "cycle" ? (
                <g
                  transform={`translate(${(from.x + to.x) / 2},${(from.y + to.y) / 2 - (Math.abs(to.y - from.y) < 25 ? 72 : 14)})`}
                >
                  <rect
                    x={-edge.label.length * 3.6 - 8}
                    y="-13"
                    width={edge.label.length * 7.2 + 16}
                    height="22"
                    rx="7"
                    fill="#fcfbf8"
                  />
                  <text textAnchor="middle" fontSize="13" fill="#817590">
                    {edge.label}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      {scene.nodes
        .filter((node) => visible.has(node.id))
        .map((node) => {
          const position = positions.get(node.id)!;
          const active = highlighted.has(node.id);
          const lines = wrapLabel(node.label, axes ? 20 : 23);
          const width = axes ? 200 : 218;
          const height = axes ? 58 : 86;
          return (
            <g
              key={`${scene.id}-${node.id}`}
              className={`board-node ${active ? "node-active" : ""}`}
              transform={`translate(${position.x},${position.y})`}
              role="button"
              tabIndex={0}
              aria-label={`Ask about ${node.label}`}
              onClick={() => onSelect(node.label)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.label);
                }
              }}
            >
              <rect
                x={-width / 2}
                y={-height / 2}
                width={width}
                height={height}
                rx="16"
                fill={active ? "#f0eafb" : "#fffefd"}
                stroke={active ? "#9680d8" : "#ddd6e8"}
                strokeWidth={active ? 2 : 1.5}
              />
              <text
                textAnchor="middle"
                fill={active ? "#6850ab" : "#514861"}
                fontSize={node.kind === "equation" ? 21 : axes ? 15 : 17}
                fontWeight="600"
              >
                {lines.map((line, i) => (
                  <tspan key={i} x="0" y={-(lines.length - 1) * 10 + i * 20 + 5}>
                    {line}
                  </tspan>
                ))}
              </text>
              {!axes && node.detail ? (
                <text x="0" y={height / 2 + 23} textAnchor="middle" fill="#89818e" fontSize="12.5">
                  {wrapLabel(node.detail, 32).map((line, i) => (
                    <tspan x="0" dy={i ? 17 : 0} key={i}>
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : null}
              {active ? (
                <circle cx={width / 2 - 13} cy={-height / 2 + 13} r="3.5" fill="#9c85db" />
              ) : null}
            </g>
          );
        })}
    </svg>
  );
}

export function WelcomeBoard() {
  return (
    <div
      className="welcome-board"
      aria-label="Illustration of a question becoming a visual explanation"
    >
      <div className="board-sticker">A little curiosity goes a long way.</div>
      <svg viewBox="0 0 900 530" className="welcome-svg" aria-hidden="true">
        <defs>
          <marker
            id="welcome-arrow"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path d="M2 1 L8 5 L2 9" fill="none" stroke="#ad9acb" strokeWidth="1.6" />
          </marker>
        </defs>
        <path
          d="M260 220 C340 130 370 170 412 207 M530 220 C610 145 650 170 693 212"
          fill="none"
          stroke="#ad9acb"
          strokeWidth="2"
          strokeDasharray="5 5"
          markerEnd="url(#welcome-arrow)"
        />
        <g transform="translate(190,265) rotate(-7)">
          <rect
            x="-80"
            y="-60"
            width="160"
            height="120"
            rx="21"
            fill="#fff4df"
            stroke="#e4c78c"
            strokeWidth="1.5"
          />
          <text textAnchor="middle" y="7" fill="#b48b45" fontSize="45" fontFamily="Georgia,serif">
            ?
          </text>
          <text textAnchor="middle" y="97" fill="#998b75" fontSize="17">
            Get curious
          </text>
        </g>
        <g transform="translate(460,265) rotate(3)">
          <rect
            x="-82"
            y="-68"
            width="164"
            height="136"
            rx="21"
            fill="#efe9fa"
            stroke="#b7a1dc"
            strokeWidth="1.5"
          />
          <circle cx="-25" cy="-13" r="18" fill="none" stroke="#a28bc9" strokeWidth="2" />
          <circle cx="27" cy="22" r="18" fill="none" stroke="#a28bc9" strokeWidth="2" />
          <path
            d="M-9 -3 L11 12 M-25 6 L-25 34 L9 34"
            fill="none"
            stroke="#a28bc9"
            strokeWidth="2"
          />
          <text textAnchor="middle" y="105" fill="#998baf" fontSize="17">
            See it unfold
          </text>
        </g>
        <g transform="translate(730,265) rotate(-5)">
          <rect
            x="-70"
            y="-60"
            width="140"
            height="120"
            rx="21"
            fill="#eaf1e8"
            stroke="#b4c6ae"
            strokeWidth="1.5"
          />
          <path
            d="M-25 2 L-7 20 L27 -19"
            fill="none"
            stroke="#8ba47e"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text textAnchor="middle" y="97" fill="#829378" fontSize="17">
            Make it click
          </text>
        </g>
        <path
          d="M350 425 Q450 445 560 420"
          fill="none"
          stroke="#d1c5e6"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text
          x="450"
          y="120"
          textAnchor="middle"
          fill="#9e8ab9"
          fontSize="25"
          fontFamily="Georgia,serif"
          fontStyle="italic"
        >
          Let’s connect the dots.
        </text>
        <g transform="translate(570,452) rotate(-25)">
          <rect width="110" height="13" rx="5" fill="#9d85ce" />
          <path d="M110 0 L128 6.5 L110 13" fill="#cfbda5" />
          <path d="M123 4.5 L128 6.5 L123 8.5" fill="#756283" />
          <rect x="7" width="10" height="13" fill="#bba7e4" />
        </g>
      </svg>
      <div className="welcome-board-note">
        <span className="little-star">✧</span> Your next “aha!” starts here
      </div>
    </div>
  );
}
