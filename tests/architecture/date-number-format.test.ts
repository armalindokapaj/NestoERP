import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One way to write a date or a number for a reader (dates and numbers in the
 * reader's language).
 *
 * Chrome ships no Albanian `Intl` data, so `Intl.DateTimeFormat("sq")` answers
 * in whatever language the browser is set to: the server and the browser print
 * two different texts and the page fails to hydrate. Display dates, times,
 * relative times and numbers therefore go through lib/i18n/format.ts, which
 * writes English as the `Intl` call it always was and Albanian from tables.
 *
 * What stays on `Intl` are machine values: a YYYY-MM-DD for a date input, an
 * HH:MM clock, a time-zone probe, and a count inside an English validation
 * sentence (which belongs with the error-message work).
 */

const ROOT = process.cwd();
const PRIMITIVE = /Intl\s*\.\s*(DateTimeFormat|NumberFormat|RelativeTimeFormat)\b|\.toLocale(Date|Time)?String\s*\(/;

const MACHINE_VALUES = [
  "lib/i18n/format.ts",
  // YYYY-MM-DD for a date input or a query
  "app/(nesto)/meetings/meetings-section.tsx",
  "app/(nesto)/meetings/new/page.tsx",
  "app/(nesto)/projects/[projectId]/meetings/page.tsx",
  "components/meetings/meeting-ui.tsx",
  "lib/forms/dates.ts",
  "lib/modules/calendar/providers/provider.helpers.ts",
  "lib/modules/meetings/meeting.repository.ts",
  // HH:MM clocks: digits only, the same in every language
  "components/daily-logs/daily-log-workspace.tsx",
  "components/daily-logs/evidence-gallery.tsx",
  "lib/modules/calendar/calendar.format.ts",
  "lib/modules/meetings/meeting.service.ts",
  "lib/core/notifications/push.quiet-hours.ts",
  // time-zone probes and the device's zone
  "components/settings/quiet-hours-card.tsx",
  "lib/core/notifications/notification.settings.ts",
  "lib/core/time/zoned-time.ts",
];

// A number inside an English validation or error sentence: the error-message work owns these.
const ERROR_SENTENCES = [
  "lib/core/export/export-control.tsx",
  "lib/core/export/exporter.ts",
  "lib/forms/field-config.ts",
  "lib/forms/normalize.ts",
  "lib/modules/announcements/announcement.schema.ts",
  "lib/modules/clients/client.schema.ts",
  "lib/modules/contracts/units/unit-contract.schema.ts",
  "lib/modules/daily-logs/daily-log.schema.ts",
  "lib/modules/engineering/engineering.fields.ts",
  "lib/modules/engineering/engineering.schema.ts",
  "lib/modules/finance/finance.register.ts",
  "lib/modules/finance/units/unit-finance.schema.ts",
  "lib/modules/meetings/meeting.schema.ts",
  "lib/modules/project-3d/processing/glb.validate.ts",
  "lib/modules/project-planning/planning.schema.ts",
  "lib/modules/project-structure/structure.schema.ts",
  "lib/modules/sales/units/unit-sales.schema.ts",
  "lib/modules/shared/fields.ts",
  "lib/modules/tasks/task.schema.ts",
  "lib/modules/workforce/workforce.import.ts",
];

const ALLOWED = new Set([...MACHINE_VALUES, ...ERROR_SENTENCES]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) out.push(...files(file));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(file);
  }
  return out;
}

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

describe("dates and numbers in the reader's language", () => {
  it("writes display dates and numbers through lib/i18n/format.ts, not Intl", () => {
    const offenders: string[] = [];
    for (const root of ["app", "components", "lib"]) {
      for (const file of files(path.join(ROOT, root))) {
        const relative = path.relative(ROOT, file).split(path.sep).join("/");
        if (ALLOWED.has(relative)) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (!isComment(line) && PRIMITIVE.test(line)) offenders.push(`${relative}:${index + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist to files that still use a primitive", () => {
    const stale = [...ALLOWED].filter((relative) => relative !== "lib/i18n/format.ts" && !PRIMITIVE.test(readFileSync(path.join(ROOT, relative), "utf8")));
    expect(stale).toEqual([]);
  });
});
