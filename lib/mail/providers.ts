import type { MailDeliveryResult, MailProvider, ProviderMessage } from "./mail.types";

/**
 * Mail providers (PRD #38 §10, §12).
 *
 *   memory    records the message in process memory. Development and tests.
 *   console   prints the message. Local runs where the log is the inbox.
 *   resend    Resend's HTTPS API.
 *   postmark  Postmark's HTTPS API.
 *
 * The two real providers are plain `fetch` calls, not vendor SDKs, so changing
 * provider is configuration and a new provider is one class.
 */

export type SentMail = ProviderMessage & { providerMessageId: string };

const outbox: SentMail[] = [];
let sequence = 0;

export class MemoryMailProvider implements MailProvider {
  readonly name = "memory";
  readonly sink = true;

  async send(message: ProviderMessage): Promise<MailDeliveryResult> {
    sequence += 1;
    const providerMessageId = `memory-${sequence}`;
    outbox.push({ ...message, providerMessageId });
    if (process.env.NODE_ENV === "development") {
      console.info(`[mail] ${message.subject} → ${message.to}\n${message.text}`);
    }
    return { status: "SENT", providerMessageId };
  }
}

export class ConsoleMailProvider implements MailProvider {
  readonly name = "console";
  readonly sink = true;

  async send(message: ProviderMessage): Promise<MailDeliveryResult> {
    sequence += 1;
    console.info(`[mail] ${message.subject} → ${message.to}\n${message.text}`);
    return { status: "SENT", providerMessageId: `console-${sequence}` };
  }
}

/** Messages the memory provider captured, for tests and local debugging. */
export function readOutbox(): readonly SentMail[] {
  return outbox;
}

export function clearOutbox(): void {
  outbox.length = 0;
}

type HttpProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** A status worth retrying: throttled, or the provider's own failure. */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; json: Record<string, unknown> | null } | { networkError: true }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

export class ResendMailProvider implements MailProvider {
  readonly name = "resend";
  readonly sink = false;
  private readonly options: Required<Omit<HttpProviderOptions, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(options: HttpProviderOptions) {
    this.options = {
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? "https://api.resend.com").replace(/\/+$/, ""),
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? 10_000,
    };
  }

  async send(message: ProviderMessage): Promise<MailDeliveryResult> {
    const result = await postJson(
      this.options.fetchImpl,
      `${this.options.baseUrl}/emails`,
      {
        authorization: `Bearer ${this.options.apiKey}`,
        ...(message.idempotencyKey ? { "idempotency-key": message.idempotencyKey } : {}),
      },
      { from: message.from, to: [message.to], subject: message.subject, text: message.text, html: message.html },
      this.options.timeoutMs,
    );

    if ("networkError" in result) return { status: "FAILED", errorCode: "NETWORK_ERROR", retryable: true };
    if (result.status >= 200 && result.status < 300 && typeof result.json?.id === "string") {
      return { status: "SENT", providerMessageId: result.json.id };
    }
    const name = typeof result.json?.name === "string" ? result.json.name : `HTTP_${result.status}`;
    return { status: "FAILED", errorCode: name.toUpperCase().slice(0, 64), retryable: retryableStatus(result.status) };
  }
}

export class PostmarkMailProvider implements MailProvider {
  readonly name = "postmark";
  readonly sink = false;
  private readonly options: Required<Omit<HttpProviderOptions, "fetchImpl">> & {
    fetchImpl: typeof fetch;
    messageStream: string;
  };

  constructor(options: HttpProviderOptions & { messageStream?: string }) {
    this.options = {
      apiKey: options.apiKey,
      baseUrl: (options.baseUrl ?? "https://api.postmarkapp.com").replace(/\/+$/, ""),
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? 10_000,
      messageStream: options.messageStream ?? "outbound",
    };
  }

  async send(message: ProviderMessage): Promise<MailDeliveryResult> {
    const result = await postJson(
      this.options.fetchImpl,
      `${this.options.baseUrl}/email`,
      { "x-postmark-server-token": this.options.apiKey },
      {
        From: message.from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        MessageStream: this.options.messageStream,
      },
      this.options.timeoutMs,
    );

    if ("networkError" in result) return { status: "FAILED", errorCode: "NETWORK_ERROR", retryable: true };
    const errorCode = typeof result.json?.ErrorCode === "number" ? result.json.ErrorCode : null;
    if (result.status >= 200 && result.status < 300 && (errorCode === null || errorCode === 0)) {
      return {
        status: "SENT",
        providerMessageId: typeof result.json?.MessageID === "string" ? result.json.MessageID : undefined,
      };
    }
    return {
      status: "FAILED",
      errorCode: errorCode !== null ? `POSTMARK_${errorCode}` : `HTTP_${result.status}`,
      retryable: retryableStatus(result.status),
    };
  }
}

/** Stands in when a deployment that must send mail has not been told how. */
export class UnconfiguredMailProvider implements MailProvider {
  readonly sink = false;
  constructor(
    readonly name: string,
    private readonly errorCode: string,
  ) {}

  async send(): Promise<MailDeliveryResult> {
    return { status: "FAILED", errorCode: this.errorCode, retryable: false };
  }
}
