import { z } from "zod";
import { lessonContentSchema } from "../lesson";

// Constrain structure at the provider; enforce size/range limits locally with Zod.
// Groq may reject an entire generation when a string misses an incidental bound.
const bounds = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "pattern",
]);

function forGeneration(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const hints: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema") continue;
    if (bounds.has(key)) {
      hints.push(`${key}: ${value}`);
      continue;
    }
    if (key === "properties") {
      result.properties = Object.fromEntries(
        Object.entries(value as Record<string, Record<string, unknown>>).map(([name, child]) => [
          name,
          forGeneration(child),
        ]),
      );
    } else if (key === "items") result.items = forGeneration(value as Record<string, unknown>);
    else result[key] = value;
  }
  if (hints.length)
    result.description = [schema.description, `Content limits: ${hints.join(", ")}.`]
      .filter(Boolean)
      .join(" ");
  return result;
}

export const generationSchema = forGeneration(z.toJSONSchema(lessonContentSchema, { io: "input" }));
