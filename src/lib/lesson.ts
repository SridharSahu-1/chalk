import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const sceneSchema = z
  .object({
    id,
    title: z.string().min(1).max(65),
    layout: z.enum(["flow", "cycle", "comparison", "axes"]),
    nodes: z
      .array(
        z
          .object({
            id,
            label: z.string().min(1).max(32),
            detail: z.string().max(65),
            kind: z.enum(["concept", "equation"]),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    connections: z.array(z.object({ from: id, to: id, label: z.string().max(25) }).strict()).max(8),
    points: z
      .array(
        z.object({ x: z.number().min(-100).max(100), y: z.number().min(-100).max(100) }).strict(),
      )
      .max(30),
    xLabel: z.string().max(25),
    yLabel: z.string().max(25),
  })
  .strict();

export const lessonContentSchema = z
  .object({
    title: z.string().min(1).max(80),
    summary: z.string().min(1).max(200),
    scenes: z.array(sceneSchema).length(4),
    steps: z
      .array(
        z
          .object({
            sceneId: id,
            narration: z
              .string()
              .trim()
              .min(15)
              .max(180)
              .describe(
                "Aim for 21–23 spoken words, at most 180 characters. Use two short sentences and concrete teaching detail, not a caption.",
              ),
            reveal: z.array(id).max(6),
            highlight: z.array(id).max(6),
          })
          .strict(),
      )
      .min(12)
      .max(16),
    check: z
      .object({
        question: z.string().min(1).max(200),
        choices: z.array(z.string().min(1).max(120)).length(3),
        correctIndex: z.number().int().min(0).max(2),
        explanation: z.string().min(1).max(400),
      })
      .strict(),
  })
  .strict()
  .superRefine((lesson, ctx) => {
    const scenes = new Map(lesson.scenes.map((scene) => [scene.id, scene]));
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (scenes.size !== lesson.scenes.length) issue("Scene IDs must be unique.");
    for (const scene of lesson.scenes) {
      const ids = new Set(scene.nodes.map((node) => node.id));
      if (ids.size !== scene.nodes.length) issue("Node IDs must be unique within a scene.");
      for (const edge of scene.connections) {
        if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)
          issue("A connection references an invalid node.");
      }
      if (scene.layout === "axes" && scene.points.length < 2)
        issue("Axes need at least two numeric points.");
    }
    let lastScene = -1;
    const visited = new Set<string>();
    const revealed = new Map<string, Set<string>>();
    for (const step of lesson.steps) {
      const scene = scenes.get(step.sceneId);
      if (!scene) {
        issue("A step references an unknown scene.");
        continue;
      }
      const sceneIndex = lesson.scenes.indexOf(scene);
      if (sceneIndex < lastScene) issue("Teach scenes in order.");
      lastScene = sceneIndex;
      visited.add(scene.id);
      const ids = new Set(scene.nodes.map((node) => node.id));
      const visible = revealed.get(scene.id) ?? new Set<string>();
      for (const nodeId of step.reveal) {
        if (!ids.has(nodeId)) issue("A step reveals an unknown node.");
        visible.add(nodeId);
      }
      for (const nodeId of step.highlight) {
        if (!ids.has(nodeId) || !visible.has(nodeId)) issue("Highlight only visible nodes.");
      }
      if (visible.size === 0) issue("Every teaching step needs a visible concept.");
      revealed.set(scene.id, visible);
      if (/[\[\]<>]/.test(step.narration))
        issue("Narration must be plain spoken text, without voice tags or markup.");
    }
    if (visited.size !== lesson.scenes.length) issue("Every scene must be taught.");
    for (const scene of lesson.scenes) {
      if (revealed.get(scene.id)?.size !== scene.nodes.length)
        issue("Every diagram node must be explained and revealed.");
    }
    const words = lesson.steps.reduce((sum, step) => sum + step.narration.split(/\s+/).length, 0);
    if (words < 200 || words > 320) issue("Narration must contain 200–320 words; target 250–280.");
  });

export const lessonSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(80),
    topic: z.string().min(2).max(180),
    source: z.enum(["ai", "sample"]),
    content: lessonContentSchema,
  })
  .strict();

export type Scene = z.infer<typeof sceneSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type LessonContent = z.infer<typeof lessonContentSchema>;

export function boardAt(lesson: Lesson, index: number) {
  const bounded = Math.max(0, Math.min(index, lesson.content.steps.length - 1));
  const step = lesson.content.steps[bounded];
  const scene = lesson.content.scenes.find((item) => item.id === step.sceneId)!;
  const visible = new Set<string>();
  for (let i = 0; i <= bounded; i++) {
    if (lesson.content.steps[i].sceneId === scene.id) {
      lesson.content.steps[i].reveal.forEach((nodeId) => visible.add(nodeId));
    }
  }
  return { scene, visible, highlighted: new Set(step.highlight) };
}

export function wordCount(lesson: Lesson) {
  return lesson.content.steps.reduce((sum, step) => sum + step.narration.split(/\s+/).length, 0);
}
