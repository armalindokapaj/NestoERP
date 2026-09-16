import { describe, expect, it } from "vitest";

import { MAIL_TEMPLATE_KEYS } from "@/lib/mail/mail.types";
import { PostmarkMailProvider, ResendMailProvider } from "@/lib/mail/providers";
import { mailTemplateVariables, renderMailTemplate } from "@/lib/mail/templates";

/** What an email may carry, and how a provider is spoken to (PRD #38 §10, §11, §162). */

function sampleVariables(key: (typeof MAIL_TEMPLATE_KEYS)[number]): Record<string, string> {
  return Object.fromEntries(
    mailTemplateVariables(key).map((name) => [
      name,
      /url|link/i.test(name) ? "https://nesto.example/path?x=1" : `value-${name}`,
    ]),
  );
}

describe("mail templates", () => {
  it("renders every registered template with a subject, text and HTML", () => {
    for (const key of MAIL_TEMPLATE_KEYS) {
      const rendered = renderMailTemplate(key, sampleVariables(key));
      expect(rendered.subject.length, key).toBeGreaterThan(0);
      expect(rendered.text, key).toContain("https://nesto.example/path?x=1");
      expect(rendered.html, key).toContain("https://nesto.example/path?x=1".replace("&", "&amp;"));
    }
  });

  it("escapes every variable in the HTML body", () => {
    const rendered = renderMailTemplate("team.invitation", {
      inviterName: `<script>alert("x")</script>`,
      companyName: "A & B",
      acceptUrl: "https://nesto.example/invite/abc",
      expiresInDays: "7",
    });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("A &amp; B");
  });

  it("refuses a missing variable rather than sending a blank", () => {
    expect(() => renderMailTemplate("collaboration.mention", { actorName: "Ana", recordLabel: "a task" })).toThrow(/link/);
  });

  it("refuses a link that is not an http(s) URL", () => {
    expect(() =>
      renderMailTemplate("collaboration.mention", { actorName: "Ana", recordLabel: "a task", link: "javascript:alert(1)" }),
    ).toThrow(/http/);
  });

  it("keeps a subject on one line, so a variable cannot inject a header", () => {
    const rendered = renderMailTemplate("approval.requested", {
      title: "Invoice\r\nBcc: attacker@example.com",
      link: "https://nesto.example/finance",
    });
    expect(rendered.subject).not.toMatch(/[\r\n]/);
  });
});

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init: RequestInit }>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const MESSAGE = {
  to: "person@example.com",
  from: "NESTO <no-reply@nesto.example>",
  subject: "Hello",
  text: "text",
  html: "<p>html</p>",
  idempotencyKey: "key-1",
};

describe("Resend adapter", () => {
  it("sends with the API key and idempotency key, and returns the message id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new ResendMailProvider({ apiKey: "re_test", fetchImpl: fakeFetch(200, { id: "msg_1" }, calls) });
    const result = await provider.send(MESSAGE);

    expect(result).toEqual({ status: "SENT", providerMessageId: "msg_1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("marks a 5xx as retryable and a 4xx as final", async () => {
    const server = new ResendMailProvider({ apiKey: "k", fetchImpl: fakeFetch(503, {}, []) });
    expect(await server.send(MESSAGE)).toMatchObject({ status: "FAILED", retryable: true });

    const rejected = new ResendMailProvider({
      apiKey: "k",
      fetchImpl: fakeFetch(422, { name: "validation_error" }, []),
    });
    expect(await rejected.send(MESSAGE)).toMatchObject({
      status: "FAILED",
      errorCode: "VALIDATION_ERROR",
      retryable: false,
    });
  });

  it("treats a network failure as retryable", async () => {
    const provider = new ResendMailProvider({
      apiKey: "k",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(await provider.send(MESSAGE)).toEqual({ status: "FAILED", errorCode: "NETWORK_ERROR", retryable: true });
  });
});

describe("Postmark adapter", () => {
  it("sends through the server token and reads Postmark's error code", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ok = new PostmarkMailProvider({
      apiKey: "pm_test",
      fetchImpl: fakeFetch(200, { MessageID: "pm-1", ErrorCode: 0 }, calls),
    });
    expect(await ok.send(MESSAGE)).toEqual({ status: "SENT", providerMessageId: "pm-1" });
    expect((calls[0].init.headers as Record<string, string>)["x-postmark-server-token"]).toBe("pm_test");

    const inactive = new PostmarkMailProvider({
      apiKey: "pm_test",
      fetchImpl: fakeFetch(422, { ErrorCode: 406, Message: "Inactive recipient" }, []),
    });
    expect(await inactive.send(MESSAGE)).toMatchObject({ status: "FAILED", errorCode: "POSTMARK_406", retryable: false });
  });
});
