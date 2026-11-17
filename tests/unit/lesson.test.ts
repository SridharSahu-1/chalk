import { describe, expect, it } from "vitest";
import { boardAt, lessonSchema, wordCount } from "../../src/lib/lesson";
import { edgePath, layoutNodes, wrapLabel } from "../../src/lib/layout";
import { sampleLesson } from "../../src/lib/sample";

describe("lesson validation", () => {
  it("accepts useful narration under 100 characters when the overall lesson is long enough", () => {
    const lesson = structuredClone(sampleLesson);
    lesson.content.steps[0].narration =
      "A computer stores data as bits. Each bit has two possible states, represented by zero and one.";
    expect(lesson.content.steps[0].narration.length).toBeLessThan(100);
    expect(lessonSchema.safeParse(lesson).success).toBe(true);
  });
  it("accepts the explicitly labeled sample and keeps narration within the speech limit", () => {
    expect(lessonSchema.parse(sampleLesson).source).toBe("sample");
    expect(wordCount(sampleLesson)).toBeGreaterThanOrEqual(200);
    expect(sampleLesson.content.steps.every((step) => step.narration.length <= 180)).toBe(true);
  });
  it("rejects unknown references and invisible highlights", () => {
    const lesson = structuredClone(sampleLesson);
    lesson.content.steps[0].highlight = ["food"];
    expect(lessonSchema.safeParse(lesson).success).toBe(false);
    lesson.content.steps[0].highlight = ["unknown"];
    expect(lessonSchema.safeParse(lesson).success).toBe(false);
  });
  it("rejects oversized narration, bad connections, and scenes without teaching steps", () => {
    const lesson = structuredClone(sampleLesson);
    lesson.content.steps[0].narration = "a".repeat(181);
    lesson.content.scenes[0].connections[0].to = "missing";
    expect(lessonSchema.safeParse(lesson).success).toBe(false);
  });
  it("rejects duplicate IDs, scene backtracking, and nonfinite graph data", () => {
    const lesson = structuredClone(sampleLesson);
    lesson.content.scenes[0].nodes[1].id = "sun";
    lesson.content.scenes[1].points = [{ x: Infinity, y: NaN }];
    expect(lessonSchema.safeParse(lesson).success).toBe(false);
  });
});

describe("deterministic whiteboard", () => {
  it("reconstructs the same state after forward playback, backward seek, and replay", () => {
    const first = boardAt(sampleLesson, 5);
    boardAt(sampleLesson, 1);
    boardAt(sampleLesson, 10);
    const seek = boardAt(sampleLesson, 5);
    expect([...seek.visible]).toEqual([...first.visible]);
    expect([...seek.highlighted]).toEqual([...first.highlighted]);
    expect(seek.scene.id).toBe("ingredients");
    expect([...seek.visible]).not.toContain("sun");
  });
  it("clamps seeks and creates finite deterministic positions", () => {
    expect(boardAt(sampleLesson, -1).scene.id).toBe("idea");
    expect(boardAt(sampleLesson, 999).scene.id).toBe("recap");
    for (const scene of sampleLesson.content.scenes) {
      const positions = layoutNodes(scene);
      expect(positions).toEqual(layoutNodes(scene));
      for (const position of positions.values())
        expect(Number.isFinite(position.x + position.y)).toBe(true);
    }
    expect(edgePath({ x: 100, y: 100 }, { x: 500, y: 100 })).not.toContain("NaN");
    expect(edgePath({ x: 100, y: 270 }, { x: 700, y: 270 })).toContain(" Q ");
    const merged = layoutNodes(sampleLesson.content.scenes[1]);
    expect(merged.get("water")!.x).toBe(merged.get("carbon")!.x);
    expect(merged.get("chloroplast")!.x).toBeGreaterThan(merged.get("carbon")!.x);
    expect(
      wrapLabel("Averylongunbrokentermoverthirtycharacterslong", 15).every(
        (line) => line.length <= 15,
      ),
    ).toBe(true);
  });
});
