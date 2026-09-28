-- Admin Audit PRD #6 §101: the platform Audit Log lists, and filters by actor and action, across every tenant.
CREATE INDEX IF NOT EXISTS "audit_events_occurredAt_id_idx" ON "audit_events"("occurredAt", "id");
CREATE INDEX IF NOT EXISTS "audit_events_actorUserId_occurredAt_idx" ON "audit_events"("actorUserId", "occurredAt");
CREATE INDEX IF NOT EXISTS "audit_events_actionKey_occurredAt_idx" ON "audit_events"("actionKey", "occurredAt");
