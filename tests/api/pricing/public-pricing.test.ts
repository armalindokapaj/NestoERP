import { afterAll, describe, expect, it } from "vitest";

import { GET as getConfig } from "@/app/api/public/pricing/config/route";
import { POST as calculate } from "@/app/api/public/pricing/calculate/route";
import { POST as submitLead } from "@/app/api/public/pricing/lead/route";
import { prisma } from "@/lib/database/prisma";
import type { PricingRequest } from "@/lib/modules/pricing/pricing.types";

const PLATFORM: PricingRequest = { foundation: "NESTO_PLATFORM", modules: [], companies: { fullGroup: 0, jointVenture: 0, documentsOnly: 0 }, nestoProjects: { active: 1 }, rozarisProjects: [], activeUsers: 15, contractMonths: 24, promotionCode: "NESTO_LAUNCH_24" };
const ROZARIS: PricingRequest = { foundation: "ROZARIS", modules: [], companies: { fullGroup: 0, jointVenture: 0, documentsOnly: 0 }, rozarisProjects: [{ tempId: "p1", type: "LARGE" }], activeUsers: 10, contractMonths: 24, promotionCode: null };
const body = (configuration: PricingRequest, persistQuote = false) => ({ configuration, persistQuote });
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
    expect(payload.data.foundations.find((row: { id: string }) => row.id === "NESTO_PLATFORM").baseMonthlyCents).toBe(250_000);
    expect(payload.data.rozaris.classes.LARGE).toMatchObject({ monthly24Cents: 130_000, includedUsers: 10 });
    expect(payload.data.modules.find((row: { id: string }) => row.id === "SALES").includedInFoundations).toContain("ROZARIS");
    // Technical modules stay server-side (§42).
    expect(payload.data.modules.some((row: { id: string }) => row.id === "DOCUMENTS_CORE")).toBe(false);
    expect(payload.data.promotions[0].code).toBe("NESTO_LAUNCH_24");
    expect(payload.data.promotions[0].displayName).toBe("NESTO ERP launch offer");
    expect(JSON.stringify(payload)).not.toContain("createdByUserId");
  });

  it("returns a server-authoritative promoted ERP quote without persisting keystrokes", async () => {
    const before = await prisma.pricingQuote.count();
    const response = await calculate(request("http://localhost/api/public/pricing/calculate", body({
      ...PLATFORM,
      companies: { fullGroup: 8, jointVenture: 0, documentsOnly: 0 },
      nestoProjects: { active: 11 },
      activeUsers: 135,
      rozarisProjects: [{ tempId: "r1", type: "LARGE" }],
    }), "2"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.standardMonthlyCents).toBe(830_000);
    expect(payload.data.preIndexationContractValueCents).toBe(16_770_000);
    expect(payload.data.quoteId).toBeNull();
    expect(await prisma.pricingQuote.count()).toBe(before);
  });

  it("persists the exact quote and pricing version at Review", async () => {
    const response = await calculate(request("http://localhost/api/public/pricing/calculate", body(PLATFORM, true), "3"));
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
    const response = await calculate(request("http://localhost/api/public/pricing/calculate", body({ ...PLATFORM, contractMonths: 12 }), "8"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.promotion).toMatchObject({ requestedCode: "NESTO_LAUNCH_24", appliedCode: null, applied: false });
    expect(payload.data.preIndexationContractValueCents).toBe(3_000_000);
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
      body: JSON.stringify(body(PLATFORM, true)),
    }));
    expect(response.status).toBe(403);
    expect(await prisma.pricingQuote.count()).toBe(before);
  });

  it("saves a ROZARIS quote with its class and Sales included (Tests B, F)", async () => {
    const response = await calculate(request("http://localhost/api/public/pricing/calculate", body({ ...ROZARIS, activeUsers: 16, modules: ["SALES"] }, true), "9"));
    const payload = await response.json();
    expect(response.status).toBe(201);
    createdQuoteIds.push(payload.data.quoteId);
    expect(payload.data.users).toMatchObject({ included: 10, billable: 6, packs: 2, monthlyCents: 35_000 });
    expect(payload.data.modules.find((row: { id: string }) => row.id === "SALES")).toMatchObject({ included: true, locked: true });
    const stored = await prisma.pricingQuote.findUniqueOrThrow({ where: { id: payload.data.quoteId } });
    expect(stored.productMode).toBe("ROZARIS");
    expect(stored.standardMonthlyCents).toBe(BigInt(165_000));
  });

  it("links a consented lead to the saved quote without trusting client pricing", async () => {
    const quoteResponse = await calculate(request("http://localhost/api/public/pricing/calculate", body(ROZARIS, true), "4"));
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
    const invalid = await calculate(request("http://localhost/api/public/pricing/calculate", body({ ...PLATFORM, activeUsers: -1 }), "6"));
    expect(invalid.status).toBe(422);

    const emptyStandalone = await calculate(request("http://localhost/api/public/pricing/calculate", body({ ...ROZARIS, rozarisProjects: [] }, true), "7"));
    expect(emptyStandalone.status).toBe(422);
  });
});
