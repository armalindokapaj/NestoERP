import { prisma } from "../../helpers";

/**
 * What a reminder job's runs leave behind, for a contract test to take away
 * again (PRD #51 §173).
 *
 * A job runs over every company it may enter, so a test that runs it also
 * reminds people about seeded records it never made. `rememberTrail` notes the
 * ledger rows and outbox events the job has before the test; the function it
 * returns deletes the ones the test's runs added, and nothing else — a
 * reminder sent before the test stays sent.
 */
export async function rememberTrail(jobKey: string, eventTypes: string[]): Promise<() => Promise<void>> {
  const [keys, events] = await Promise.all([ledgerRows(jobKey), outboxIds(eventTypes)]);
  const keysBefore = new Set(keys.map(keyOf));
  const eventsBefore = new Set(events);
  return async () => {
    const addedKeys = (await ledgerRows(jobKey)).filter((row) => !keysBefore.has(keyOf(row)));
    if (addedKeys.length) await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey, OR: addedKeys.map((row) => ({ companyId: row.companyId, key: row.key })) } });
    const addedEvents = (await outboxIds(eventTypes)).filter((id) => !eventsBefore.has(id));
    if (addedEvents.length) await prisma.notificationEventOutbox.deleteMany({ where: { id: { in: addedEvents } } });
  };
}

const keyOf = (row: { companyId: string; key: string }) => `${row.companyId} ${row.key}`;

function ledgerRows(jobKey: string) {
  return prisma.jobIdempotencyKey.findMany({ where: { jobKey }, select: { companyId: true, key: true } });
}

async function outboxIds(eventTypes: string[]): Promise<string[]> {
  return (await prisma.notificationEventOutbox.findMany({ where: { eventType: { in: eventTypes } }, select: { id: true } })).map((row) => row.id);
}
