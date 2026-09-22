import { afterAll, describe, expect, it } from "vitest";

import { GET as getConfig } from "@/app/api/public/pricing/config/route";
import { POST as calculate } from "@/app/api/public/pricing/calculate/route";
import { POST as submitLead } from "@/app/api/public/pricing/lead/route";
import { prisma } from "@/lib/database/prisma";
import { DEFAULT_PRICING_REQUEST } from "@/lib/modules/pricing/pricing.config";
import { assertPublicMutationOrigin } from "@/lib/modules/pricing/pricing.http";

const createdQuoteIds: string[] = [];

function request(url: string, body?: unknown, suffix = "1") {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json", origin: "http://localhost" }),
      "x-forwarded-for": `198.51.100.${suffix}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

afterAll(async () => {
  if (!createdQuoteIds.length) return;
  await prisma.pricingLead.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
  await prisma.pricingAuditLog.deleteMany({ where: { entityType: "PricingQuote", entityId: { in: createdQuoteIds } } });
  await prisma.pricingQuote.deleteMany({ where: { id: { in: createdQuoteIds } } });
});

describe("public pricing API", () => {
  it("checks browser origins against the proxy-visible host", () => {
    const proxiedRequest = new Request("http://localhost/api/public/pricing/lead", {
      headers: {
        host: "localhost:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "127.0.0.1:3000",
      },
    });
    expect(() => assertPublicMutationOrigin(proxiedRequest)).not.toThrow();

    const crossSiteRequest = new Request("http://localhost/api/public/pricing/lead", {
      headers: { host: "localhost", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    });
    expect(() => assertPublicMutationOrigin(crossSiteRequest)).toThrow("Cross-site requests are not accepted.");
  });

  it("returns the sanitized active price book and promotion", async () => {
    const response = await getConfig(request("http://localhost/api/public/pricing/config"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.pricingVersion).toBe("2026.09");
    expect(payload.data.publicRules.nestoERP.baseMonthlyCents).toBe(250_000);
    expect(payload.data.promotions[0].code).toBe("NESTO_LAUNCH_24");
    expect(payload.data.promotions[0].displayName).toBe("NESTO ERP launch offer");
    expect(JSON.stringify(payload)).not.toContain("createdByUserId");
  });

  it("returns a server-authoritative promoted ERP quote without persisting keystrokes", async () => {
    const before = await prisma.pricingQuote.count();
    const response = await calculate(request("http://localhost/api/public/pricing/calculate", {
      ...DEFAULT_PRICING_REQUEST,
      companies: { additionalGroup: 8, jointVenture: 0, documentsOnly: 0 },
      activeProjects: 11,
      activeUsers: 135,
      rozaris: { basicProjects: 0, largeProjects: 1, villageProjects: 0 },
      persistQuote: false,
    }, "2"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.standardMonthly).toBe(8_300);
    expect(payload.data.contract.preIndexationValue).toBe(167_700);
    expect(payload.data.quoteId).toBeNull();
    expect(await prisma.pricingQuote.count()).toBe(before);
  });

  it("persists the exact quote and pricing version at Review", async () => {
    const response = await calculate(request("http://localhost/api/public/pricing/calculate", {
      ...DEFAULT_PRICING_REQUEST,
      persistQuote: true,
    }, "3"));
    const payload = await response.json();
    expect(response.status).toBe(201);
    createdQuoteIds.push(payload.data.quoteId);
    const stored = await prisma.pricingQuote.findUniqueOrThrow({ where: { id: payload.data.quoteId } });
    expect(stored.reference).toMatch(/^NESTO-[A-F0-9]{8}$/);
    expect(stored.pricingVersionCode).toBe("2026.09");
    expect(stored.standardMonthlyCents).toBe(BigInt(250_000));
    expect(stored.preIndexationValueCents).toBe(BigInt(4_875_000));
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1_000);
  });

  it("does not apply the 24-month promotion to a 12-month calculation", async () => {
    const response = await calculate(request("http://localhost/api/public/pricing/calculate", {
      ...DEFAULT_PRICING_REQUEST,
      contractMonths: 12,
      promotionCode: "NESTO_LAUNCH_24",
      persistQuote: false,
    }, "8"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.promotion).toMatchObject({ requestedCode: "NESTO_LAUNCH_24", appliedCode: null, applied: false });
    expect(payload.data.contract.preIndexationValue).toBe(30_000);
  });

  it("rejects cross-site attempts to persist anonymous quotes", async () => {
    const before = await prisma.pricingQuote.count();
    const response = await calculate(new Request("http://localhost/api/public/pricing/calculate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "localhost",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "x-forwarded-for": "198.51.100.9",
      },
      body: JSON.stringify({ ...DEFAULT_PRICING_REQUEST, persistQuote: true }),
    }));
    expect(response.status).toBe(403);
    expect(await prisma.pricingQuote.count()).toBe(before);
  });

  it("links a consented lead to the saved quote without trusting client pricing", async () => {
    const quoteResponse = await calculate(request("http://localhost/api/public/pricing/calculate", {
      ...DEFAULT_PRICING_REQUEST,
      rozaris: { basicProjects: 1, largeProjects: 0, villageProjects: 0 },
      persistQuote: true,
    }, "4"));
    const quote = (await quoteResponse.json()).data;
    createdQuoteIds.push(quote.quoteId);
    const response = await submitLead(request("http://localhost/api/public/pricing/lead", {
      quoteId: quote.quoteId,
      requestType: "FORMAL_PROPOSAL",
      fullName: "Pricing Test",
      companyName: "Example Construction",
      businessEmail: "pricing-test@example.com",
      phone: null,
      message: "Please prepare the proposal.",
      consent: true,
    }, "5"));
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.data.reference).toBe(quote.quoteReference);
    const stored = await prisma.pricingQuote.findUniqueOrThrow({ where: { id: quote.quoteId }, include: { leads: true } });
    expect(stored.status).toBe("PROPOSAL_REQUESTED");
    expect(stored.leads).toHaveLength(1);
    expect(stored.leads[0].businessEmail).toBe("pricing-test@example.com");
  });

  it("rejects invalid input and standalone proposal requests without a ROZARIS project", async () => {
    const invalid = await calculate(request("http://localhost/api/public/pricing/calculate", {
      ...DEFAULT_PRICING_REQUEST,
      activeUsers: -1,
    }, "6"));
    expect(invalid.status).toBe(422);

    const emptyStandalone = await calculate(request("http://localhost/api/public/pricing/calculate", {
      ...DEFAULT_PRICING_REQUEST,
      productMode: "ROZARIS_ONLY",
      activeProjects: 0,
      promotionCode: null,
      persistQuote: true,
    }, "7"));
    expect(emptyStandalone.status).toBe(422);
  });
});
