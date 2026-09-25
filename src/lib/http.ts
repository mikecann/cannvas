/**
 * Read a JSON reply from the Pi's local server.
 *
 * A proxy or a crashed server can answer with an HTML or plain text error
 * page, so check the content type before parsing. Errors carry the server's
 * `error` message when it sent one, otherwise `fallback`.
 */
export async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const isJson = (response.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json");
  let body: (T & { error?: unknown }) | undefined;
  if (isJson) {
    try {
      body = await response.json() as T & { error?: unknown };
    } catch {
      body = undefined;
    }
  }
  if (!response.ok) {
    const message = body && typeof body.error === "string" && body.error ? body.error : fallback;
    throw new Error(message);
  }
  if (body === undefined) throw new Error(fallback);
  return body;
}

export function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
