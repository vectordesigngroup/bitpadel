import { AppError } from "../errors.js";
import { isRecord } from "../validate.js";
import type { MessageProvider, OutboundMessage } from "./types.js";

/**
 * Generic SMS webhook. The club's own service receives JSON
 * `{ to, text, kind }` and may optionally require a bearer token.
 */
export class WebhookSmsProvider implements MessageProvider {
  readonly id = "webhook";
  readonly channel = "sms" as const;

  constructor(
    private readonly url: string,
    private readonly token: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<{ id: string }> {
    if (message.channel !== "sms") throw new Error("Webhook provider only sends SMS");
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: message.to, text: message.text, kind: message.kind }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(502, "SMS webhook did not respond");
    }
    const text = await response.text();
    if (!response.ok) throw new AppError(502, `SMS webhook returned HTTP ${response.status}`);
    let parsed: unknown = null;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      parsed = null;
    }
    const id = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : "webhook";
    return { id };
  }
}
