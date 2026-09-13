# Collaboration incident runbook

Per PRD #38 §30-§32, §176.

**Any suspected cross-tenant exposure is P0.** Stop, contain, then investigate.

## How collaboration decides access

Comments, mentions and watchers never grant anything. Every read and write on
a discussion re-reads its parent record through the record registry
(`lib/core/records/record.registry.ts`) in the caller's own context, and the
notification dispatcher re-reads the record for each recipient before writing a
notification. The registry lookups always carry `companyId`.

So an exposure is almost always one of:

1. a registry definition whose `find` clause is wrong for its record type
2. a thread whose `(companyId, parentType, parentId)` points at the wrong record
3. a notification written before a recipient's access changed (historical text
   shown, but the link re-authorises)

## Cross-tenant comment exposure

Symptoms: a user reports seeing a comment, a name or a record label from
another company.

1. **Contain.** Identify the parent type involved. Set its
   `collaboration: null` in the registry and deploy — every discussion on that
   type then answers NOT_FOUND. This is safe: nothing is deleted.
2. **Confirm.** Check the thread and its comments are in one company:

   ```sql
   SELECT t."id", t."companyId", t."parentType", t."parentId",
          count(*) FILTER (WHERE c."companyId" <> t."companyId") AS foreign_comments
   FROM collaboration_threads t
   LEFT JOIN comments c ON c."threadId" = t."id"
   GROUP BY t."id" HAVING count(*) FILTER (WHERE c."companyId" <> t."companyId") > 0;
   ```

3. **Find the exposure window** in the audit log: `COMMENT_CREATED` events for
   the affected threads carry the actor and time, not the text.
4. Fix the registry definition, add a test to
   `tests/api/collaboration/collaboration-service.test.ts` reproducing it, and
   re-enable.

## Mention recipient error

Symptoms: somebody was notified about a mention on a record they cannot open,
or a mention went to the wrong person.

- A notification is historical: its title may name the record, but
  `/notifications/:id/open` re-authorises and shows "no longer available". If
  the title itself is the leak, delete those notification rows
  (`eventType = 'COMMENT_MENTIONED'`, by `entityId`) and follow the cross-tenant
  steps above.
- Mentions are validated when the comment is written (same company, active,
  can read the record) and again at dispatch. A mention delivered to somebody
  who could not read the record means the registry definition disagrees with the
  module's own scope — compare `find` with the module's list page clause.

## Notification leak

Symptoms: a notification title or body carries content the recipient should
not have.

1. Identify the event type. Titles and bodies are built in
   `lib/core/notifications/notification.events.ts` from the event payload.
2. Remove the offending rows: `DELETE FROM notifications WHERE "eventType" = …
   AND "createdAt" > …`.
3. If the payload itself carries sensitive fields, change the producer to stop
   sending them, and the definition to stop rendering them.
4. Email copies cannot be recalled; `mail_deliveries` lists who was sent one
   (`entityType = 'Notification'`).

## Thread–parent mismatch

Symptoms: a discussion appears on the wrong record.

A thread is unique per `(companyId, parentType, parentId)` and created only by
`ensureThread`. A mismatch means a record id was reused or a producer passed the
wrong type. Find the thread, confirm the parent, and move comments only with a
reviewed SQL change recorded in the incident — there is no UI for it, by design.

## After any incident

- Record the incident, the exposure window and the affected companies.
- Owners of affected companies are told what was visible and to whom.
- Add a regression test before closing.
