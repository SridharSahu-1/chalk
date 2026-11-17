import { AppError } from "./http";

export async function groq(path: string, body: unknown, signal: AbortSignal) {
  const key = process.env.GROQ_API_KEY;
  if (!key)
    throw new AppError(
      "NOT_CONFIGURED",
      "Live AI is not configured yet. Add GROQ_API_KEY to the server environment, or explore the labeled sample lesson.",
      503,
    );
  let response: Response;
  const started = performance.now();
  try {
    response = await fetch(`https://api.groq.com/openai/v1/${path}`, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "TimeoutError"))
      throw new AppError("TIMEOUT", "The AI service took too long. Please try again.", 504);
    throw new AppError(
      "UNAVAILABLE",
      "The AI service could not be reached. Please try again.",
      502,
    );
  }
  console.info(
    JSON.stringify({
      event: "provider_request",
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    }),
  );
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new AppError(
      "RATE_LIMITED",
      "The free AI quota is temporarily exhausted. Please try again later.",
      429,
      Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : undefined,
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new AppError(
      "NOT_CONFIGURED",
      "The AI service key or model access needs attention. Check the server configuration.",
      503,
    );
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    if (["json_validate_failed", "json_generation_failed"].includes(details?.error?.code)) {
      throw new AppError(
        "INVALID_OUTPUT",
        "The AI could not format the lesson correctly. Please try again.",
        502,
      );
    }
    if (details?.error?.code === "model_terms_required") {
      throw new AppError(
        "MODEL_TERMS_REQUIRED",
        "AI voice requires the account owner to accept the Orpheus model terms in Groq Console. Browser voice is available in the meantime.",
        503,
      );
    }
    throw new AppError(
      "UNAVAILABLE",
      "The AI service could not complete this request. Please try again.",
      502,
    );
  }
  return response;
}

export async function completion(
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  schema?: unknown,
) {
  const response = await groq(
    "chat/completions",
    {
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      messages,
      temperature: 0.5,
      reasoning_effort: "low",
      max_completion_tokens: schema ? 4000 : 800,
      ...(schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "teaching_lesson", strict: true, schema },
            },
          }
        : {}),
    },
    signal,
  );
  const data = await response.json();
  const choice = data.choices?.[0];
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
      "The AI returned an incomplete response. Please try again.",
      502,
    );
  }
  return choice.message.content as string;
}
