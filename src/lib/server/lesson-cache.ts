import type { LessonContent } from "../lesson";

// Public teaching content only. Bounded, best-effort cache within one server instance.
const lessons = new Map<string, { content: LessonContent; expires: number }>();
const TTL = 30 * 60_000;

export function clearLessonCache() {
  lessons.clear();
}

export async function cachedLesson(
  topic: string,
  generate: () => Promise<LessonContent>,
): Promise<LessonContent> {
  const key = topic.trim().replace(/\s+/g, " ");
  const saved = lessons.get(key);
  if (saved && saved.expires > Date.now()) return saved.content;
  if (saved) lessons.delete(key);
  const content = await generate();
  lessons.set(key, { content, expires: Date.now() + TTL });
  while (lessons.size > 10) lessons.delete(lessons.keys().next().value!);
  return content;
}
