export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

// Best-effort per-instance limits. Provider quotas remain the shared hard boundary.
const buckets = new Map<string, { count: number; reset: number }>();

function checkOrigin(request: Request) {
  const supplied = request.headers.get("origin");
  if (!supplied) return;
  try {
    const internal = new URL(request.url);
    // Next may use the bind address in request.url (for example 0.0.0.0).
    // Host retains the address the browser requested. The proxy supplies the scheme.
    const host = request.headers.get("host") ?? internal.host;
    const forwarded = request.headers.get("x-forwarded-proto");
    const protocol =
      forwarded === "https" || forwarded === "http" ? `${forwarded}:` : internal.protocol;
    const expected = new URL(`${protocol}//${host}`).origin;
    const origin = new URL(supplied);
    if (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      supplied === origin.origin &&
      origin.origin === expected
    )
      return;
  } catch {
    /* Malformed and opaque origins are rejected below. */
  }
  throw new AppError("FORBIDDEN", "Request origin is not allowed.", 403);
}

export async function readBody(request: Request, maxBytes = 32_000): Promise<unknown> {
  checkOrigin(request);
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${new URL(request.url).pathname}:${client}`;
  const now = Date.now();
  if (buckets.size > 1000)
    for (const [id, bucket] of buckets) if (bucket.reset < now) buckets.delete(id);
  const bucket = buckets.get(key);
  if (bucket && bucket.reset > now && bucket.count >= 30)
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests. Please try again in a minute.",
      429,
      Math.ceil((bucket.reset - now) / 1000),
    );
  if (!bucket || bucket.reset <= now) buckets.set(key, { count: 1, reset: now + 60_000 });
  else bucket.count++;
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "A request body is required.", 400);
  let size = 0;
  const decoder = new TextDecoder();
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError("INVALID_INPUT", "This request is too large.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_INPUT", "Please send valid JSON.", 400);
  } finally {
    reader.releaseLock();
  }
}

export function errorResponse(error: unknown) {
  const known =
    error instanceof AppError
      ? error
      : new AppError("UNAVAILABLE", "Something went wrong. Please try again.");
  if (known.status >= 500)
    console.error(JSON.stringify({ code: known.code, status: known.status }));
  return Response.json(
    { error: { code: known.code, message: known.message, retryAfter: known.retryAfter ?? null } },
    {
      status: known.status,
      headers: {
        "Cache-Control": "no-store",
        ...(known.retryAfter ? { "Retry-After": String(known.retryAfter) } : {}),
      },
    },
  );
}
