import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import {
  baseCurrencyLocked,
  companySettingsSchema,
  getCompanySettings,
  updateCompanySettings,
} from "@/lib/modules/settings/company-settings.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Finance defaults on the company settings page (PRD #24 §15, §17, PRD #47 §61).
 *
 * Base currency, tax and payment terms sit behind `company.finance_settings.*`.
 * An Admin is denied those grants outright and IT holds `company.settings.update`
 * without them, so both used to read — and write — the ledger's defaults
 * through the ordinary settings endpoint.
 */

let startedAt: Date;
let snapshot: Awaited<ReturnType<typeof prisma.companySettings.findUniqueOrThrow>>;

beforeAll(async () => {
  const owner = await loginAs("OWNER");
  snapshot = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: owner.companyId } });
});

afterEach(async () => {
  await prisma.companySettings.update({
    where: { companyId: snapshot.companyId },
    data: {
      locale: snapshot.locale,
      timezone: snapshot.timezone,
      dateFormat: snapshot.dateFormat,
      baseCurrency: snapshot.baseCurrency,
      fiscalYearStartMonth: snapshot.fiscalYearStartMonth,
      defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays,
      defaultTaxRate: snapshot.defaultTaxRate,
    },
  });
  if (startedAt) {
    await prisma.auditEvent.deleteMany({
      where: {
        companyId: snapshot.companyId,
        actionKey: { in: [AuditAction.COMPANY_SETTINGS_UPDATED, AuditAction.COMPANY_BASE_CURRENCY_CHANGED] },
        occurredAt: { gte: startedAt },
      },
    });
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

function base() {
  return { locale: snapshot.locale, timezone: snapshot.timezone, dateFormat: snapshot.dateFormat };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
}

describe("reading finance defaults (PRD #47 §61)", () => {
  it("withholds them from an Admin, who is denied the finance grant", async () => {
    const settings = await getCompanySettings(await loginAs("ADMIN"));
    expect(settings.financeVisible).toBe(false);
    for (const field of ["baseCurrency", "fiscalYearStartMonth", "defaultPaymentTermsDays", "defaultTaxRate"]) {
      expect(settings).not.toHaveProperty(field);
    }
    expect(settings.locale).toBe(snapshot.locale);
  });

  it("shows them to the Owner", async () => {
    const settings = await getCompanySettings(await loginAs("OWNER"));
    expect(settings).toMatchObject({ financeVisible: true, baseCurrency: snapshot.baseCurrency });
  });
});

describe("changing finance defaults (PRD #47 §61)", () => {
  beforeAll(() => {
    startedAt = new Date(Date.now() - 1000);
  });

  it("refuses an Admin changing payment terms, and leaves them as they were", async () => {
    const admin = await loginAs("ADMIN");
    const input = companySettingsSchema.parse({
      ...base(),
      defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays + 7,
    });

    await expectCode(updateCompanySettings(admin, input), "FORBIDDEN");
    const row = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: snapshot.companyId } });
    expect(row.defaultPaymentTermsDays).toBe(snapshot.defaultPaymentTermsDays);
  });

  it("refuses IT, who may update settings but not the tax rate", async () => {
    const it_ = await loginAs("COMPANY_IT");
    const input = companySettingsSchema.parse({ ...base(), defaultTaxRate: "99.5" });
    await expectCode(updateCompanySettings(it_, input), "FORBIDDEN");
  });

  it("lets an Admin save localisation alone, and round-trip unchanged finance values", async () => {
    const admin = await loginAs("ADMIN");

    const localisationOnly = await updateCompanySettings(
      admin,
      companySettingsSchema.parse({ ...base(), dateFormat: "YYYY-MM-DD" }),
    );
    expect(localisationOnly).toMatchObject({ financeVisible: false, dateFormat: "YYYY-MM-DD" });

    // The same values the form would post back unchanged: not a finance change.
    await updateCompanySettings(
      admin,
      companySettingsSchema.parse({
        ...base(),
        baseCurrency: snapshot.baseCurrency,
        fiscalYearStartMonth: String(snapshot.fiscalYearStartMonth),
        defaultPaymentTermsDays: String(snapshot.defaultPaymentTermsDays),
        // "20.0000" for a stored 20: the same rate, written differently.
        defaultTaxRate: snapshot.defaultTaxRate === null ? "" : Number(snapshot.defaultTaxRate).toFixed(4),
      }),
    );

    const row = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: snapshot.companyId } });
    expect(row.defaultPaymentTermsDays).toBe(snapshot.defaultPaymentTermsDays);
    expect(row.defaultTaxRate?.toString() ?? null).toBe(snapshot.defaultTaxRate?.toString() ?? null);
  });

  it("lets the Owner change them", async () => {
    const owner = await loginAs("OWNER");
    const updated = await updateCompanySettings(
      owner,
      companySettingsSchema.parse({ ...base(), defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays + 1 }),
    );
    expect(updated).toMatchObject({ financeVisible: true, defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays + 1 });
  });

  it("answers a locked base currency as a 409 the form can explain, not a 500", async () => {
    const owner = await loginAs("OWNER");
    if (!(await baseCurrencyLocked(owner.companyId))) return;

    const other = snapshot.baseCurrency === "EUR" ? "USD" : "EUR";
    const failure = await updateCompanySettings(owner, companySettingsSchema.parse({ ...base(), baseCurrency: other })).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(AccessError);
    expect(failure).toMatchObject({ code: "CONFLICT", details: { code: "BASE_CURRENCY_LOCKED" } });
  });
});
