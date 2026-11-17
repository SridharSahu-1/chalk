import { z } from "zod";
import { groq } from "@/lib/server/groq";
import { AppError, errorResponse, readBody } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 25;
const schema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((text) => !/[\[\]<>]/.test(text)),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = schema.safeParse(await readBody(request, 2000));
    if (!input.success)
      throw new AppError(
        "INVALID_INPUT",
        "Speech requires 1–180 characters of plain narration.",
        400,
      );
    const response = await groq(
      "audio/speech",
      {
        model: process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
        voice: process.env.GROQ_TTS_VOICE || "troy",
        input: input.data.text,
        response_format: "wav",
      },
      AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    );
    const bytes = await response.arrayBuffer();
    const decoder = new TextDecoder();
    const riff = decoder.decode(bytes.slice(0, 4));
    const wave = decoder.decode(bytes.slice(8, 12));
    if (
      riff !== "RIFF" ||
      wave !== "WAVE" ||
      bytes.byteLength < 44 ||
      bytes.byteLength > 4_000_000
    ) {
      throw new AppError("INVALID_AUDIO", "The voice service returned unusable audio.", 502);
    }
    return new Response(bytes, {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
