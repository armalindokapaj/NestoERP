-- The public calculator must never have two active price books. A partial
-- unique index keeps this true even when separate server instances publish at
-- the same time.
CREATE UNIQUE INDEX "pricing_versions_single_active_idx"
ON "pricing_versions" ("status")
WHERE "status" = 'ACTIVE';
