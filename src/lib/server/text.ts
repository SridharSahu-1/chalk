import { completion as groqCompletion } from "./groq";
import { AppError } from "./http";

type Message = { role: string; content: string };
type Provider = {
  id: string;
  run(messages: Message[], signal: AbortSignal, schema?: unknown): Promise<string>;
};
const cooldowns = new Map<string, { until: number; error: AppError }>();

// Shared by lessons and follow-ups. Exported for isolated, deterministic tests.
export function clearProviderCooldowns() {
  cooldowns.clear();
}

async function openRouter(messages: Message[], signal: AbortSignal, schema?: unknown) {
  const model = process.env.OPENROUTER_MODEL || "particle-ai/particle-1:free";
  if (model !== "openrouter/free" && !model.endsWith(":free")) {
    throw new AppError(
      "NOT_CONFIGURED",
      "OPENROUTER_MODEL must be openrouter/free or a model ending in :free. Paid models are disabled.",
      503,
    );
  }
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Chalk Whiteboard Tutor",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.5,
        max_tokens: schema ? 4000 : 1200,
        reasoning: { enabled: false },
        ...(schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "teaching_lesson", strict: true, schema },
              },
              provider: { require_parameters: true },
            }
          : {}),
      }),
    });
  } catch {
    throw new AppError(
      signal.aborted ? "TIMEOUT" : "UNAVAILABLE",
      "The backup AI service could not be reached.",
      502,
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    if (signal.aborted)
      throw new AppError(
        "TIMEOUT",
        "The backup AI took too long to finish. Please try again.",
        502,
      );
    if (response.ok)
      throw new AppError(
        "INVALID_OUTPUT",
        "The backup AI returned an incomplete response. Please try again.",
        502,
      );
    // HTTP errors can have empty/plain-text bodies; preserve their status below.
    data = null;
  }
  const status = response.ok && data?.error ? Number(data.error.code) || 502 : response.status;
  if (status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    throw new AppError(
      "RATE_LIMITED",
      "The free backup AI quota is temporarily exhausted.",
      429,
      Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 30,
    );
  }
  if ([401, 402, 403].includes(status))
    throw new AppError(
      "NOT_CONFIGURED",
      "Check the OpenRouter key and free-model access. Paid upgrades are not required by this app.",
      503,
    );
  if (!response.ok || data?.error)
    throw new AppError(
      "UNAVAILABLE",
      "The free backup AI service is temporarily unavailable.",
      502,
    );
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === "content_filter")
    throw new AppError(
      "REFUSED",
      "The tutor could not explain that topic. Try a different educational topic.",
      422,
    );
  if (
    choice?.finish_reason !== "stop" ||
    typeof choice?.message?.content !== "string" ||
    !choice.message.content.trim()
  ) {
    throw new AppError(
      "INVALID_OUTPUT",
      "The backup AI returned an incomplete response. Please try again.",
      502,
    );
  }
  return choice.message.content as string;
}

export async function completion(
  messages: Message[],
  signal: AbortSignal,
  schema?: unknown,
  validate?: (output: string) => unknown,
) {
  const providers: Provider[] = [];
  if (process.env.GROQ_API_KEY) providers.push({ id: "groq", run: groqCompletion });
  if (process.env.OPENROUTER_API_KEY) providers.push({ id: "openrouter", run: openRouter });
  if (!providers.length)
    throw new AppError(
      "NOT_CONFIGURED",
      "Add GROQ_API_KEY or OPENROUTER_API_KEY to the server environment, or explore the labeled sample lesson.",
      503,
    );
  const failures: AppError[] = [];
  for (const provider of providers) {
    if (signal.aborted)
      throw new AppError(
        "TIMEOUT",
        "Lesson generation was interrupted or took too long. Please try again.",
        504,
      );
    const cooldown = cooldowns.get(provider.id);
    if (cooldown && cooldown.until > Date.now()) {
      failures.push(
        new AppError(
          cooldown.error.code,
          cooldown.error.message,
          cooldown.error.status,
          Math.ceil((cooldown.until - Date.now()) / 1000),
        ),
      );
      continue;
    }
    try {
      const text = await provider.run(
        messages,
        AbortSignal.any([
          signal,
          AbortSignal.timeout(provider.id === "openrouter" ? 25_000 : 18_000),
        ]),
        schema,
      );
      validate?.(text);
      cooldowns.delete(provider.id);
      console.info(JSON.stringify({ event: "text_provider_success", provider: provider.id }));
      return text;
    } catch (error) {
      if (signal.aborted)
        throw new AppError("TIMEOUT", "The AI request took too long. Please try again.", 504);
      if (!(error instanceof AppError) || error.code === "REFUSED") throw error;
      failures.push(error);
      if (["RATE_LIMITED", "UNAVAILABLE", "TIMEOUT", "NOT_CONFIGURED"].includes(error.code)) {
        cooldowns.set(provider.id, {
          until:
            Date.now() + (error.retryAfter ?? (error.code === "RATE_LIMITED" ? 30 : 10)) * 1000,
          error,
        });
      }
      console.info(
        JSON.stringify({
          event: "text_provider_fallback",
          provider: provider.id,
          code: error.code,
        }),
      );
    }
  }
  const limited = failures.filter((error) => error.code === "RATE_LIMITED");
  if (limited.length === failures.length) {
    const retryAfter = Math.min(...limited.map((error) => error.retryAfter ?? 30));
    throw new AppError(
      "RATE_LIMITED",
      providers.length === 1
        ? "Only one AI provider is configured and it is cooling down. Please retry after the countdown, or configure a second free provider."
        : "All configured free AI providers are temporarily rate limited. Please retry after the countdown.",
      429,
      retryAfter,
    );
  }
  throw (
    failures.find((error) => error.code === "INVALID_OUTPUT") ??
    failures.find((error) => error.code === "NOT_CONFIGURED") ??
    failures.at(-1) ??
    new AppError("UNAVAILABLE", "The AI providers are unavailable. Please try again.", 502)
  );
}
