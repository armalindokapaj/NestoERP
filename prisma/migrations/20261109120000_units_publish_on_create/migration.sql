-- Units publish on create (2026-11; docs/unit-publishing.md).
--
-- A unit is published the moment it is created, every change to what it
-- publishes goes out at once as its next version, and archive is the only way
-- out of use. Draft, Ready for Publishing and Revision Required, the unit
-- publishing requests and the "unpublished changes" flag belong to the retired
-- review workflow. This migration brings existing data in line:
--
--   1. `unit_publications.publishedByMemberId` becomes nullable: null is a
--      version published automatically — this backfill, a unit a Platform Admin
--      creates in the 3D tool, a file version the scan worker promotes.
--   2. Every unit not archived is published as it now is. A unit with no current
--      version, or whose live facts differ from its current version by the
--      publish fingerprint (`publishFingerprint`), gets its next version (max + 1)
--      with exactly the snapshot `buildSnapshot` writes; every such unit becomes
--      PUBLISHED with no unpublished changes and no revision reason. Archived
--      units are left as they are.
--   3. Every PENDING publishing request is cancelled, the way archiving a unit
--      cancelled one: the request row, its attention items, and an
--      APPROVAL_CANCELLED audit event per unit.
--
-- Each new version and each cancellation is audited as the system's, as
-- recordSystemAction writes it. Ids are derived from the rows they belong to,
-- so the statements are safe to run again; timestamps are UTC, because the
-- columns hold no time zone and the server's local time is not UTC.

-- 1. Schema -----------------------------------------------------------------

ALTER TABLE "unit_publications" ALTER COLUMN "publishedByMemberId" DROP NOT NULL;

-- 2. Publish every unit in use as it now is -----------------------------------

WITH "live" AS (
  -- What `loadPublishStates` reads and `buildSnapshot` keeps, unit by unit.
  SELECT
    u."id" AS "unitId",
    u."companyId",
    u."projectId",
    u."unitCode",
    u."publicationStatus",
    u."currentPublicationId",
    jsonb_build_object(
      'unitCode', u."unitCode",
      'name', u."name",
      'unitType', jsonb_build_object('id', t."id", 'name', t."name", 'category', t."category"),
      'building', jsonb_build_object('id', b."id", 'name', b."name", 'code', b."code"),
      'floor', jsonb_build_object('id', f."id", 'name', f."name", 'number', f."number", 'levelType', f."levelType"),
      'position', u."position",
      'orientation', u."orientation",
      -- numeric(12,2) as text is the two-decimal string Decimal#toFixed(2) gives.
      'areas', jsonb_build_object(
        'internalArea', u."internalArea"::text,
        'grossArea', u."grossArea"::text,
        'saleableArea', u."saleableArea"::text,
        'outdoorArea', u."outdoorArea"::text,
        'balconyArea', u."balconyArea"::text,
        'terraceArea', u."terraceArea"::text,
        'gardenArea', u."gardenArea"::text,
        'commonAreaAllocation', u."commonAreaAllocation"::text
      ),
      'rooms', u."rooms",
      'bedrooms', u."bedrooms",
      'bathrooms', u."bathrooms",
      -- An object with its null values dropped; anything else is no attributes.
      'attributes', CASE WHEN jsonb_typeof(u."attributes") = 'object' THEN jsonb_strip_nulls(u."attributes") ELSE '{}'::jsonb END,
      'description', u."description",
      'salesPlan', CASE WHEN sp."id" IS NULL THEN 'null'::jsonb
        ELSE jsonb_build_object('documentId', sp."id", 'documentVersionId', sp."currentVersionId", 'versionNumber', sp."versionNumber", 'fileName', sp."originalFileName") END,
      'primaryImage', CASE WHEN pm."id" IS NULL THEN 'null'::jsonb
        ELSE jsonb_build_object('documentId', pm."id", 'documentVersionId', pm."currentVersionId", 'category', pm."category", 'caption', pm."caption") END
    ) AS "snapshot",
    sp."id" AS "salesPlanDocumentId",
    sp."currentVersionId" AS "salesPlanDocumentVersionId",
    pm."id" AS "primaryMediaDocumentId",
    pm."currentVersionId" AS "primaryMediaDocumentVersionId"
  FROM "project_units" u
  JOIN "project_unit_types" t ON t."id" = u."unitTypeId"
  JOIN "project_floors" f ON f."id" = u."floorId"
  JOIN "project_buildings" b ON b."id" = f."buildingId"
  -- The Sales Plan counts only as an active, available PDF with a current version.
  LEFT JOIN LATERAL (
    SELECT d."id", d."currentVersionId", d."originalFileName", dv."versionNumber"
    FROM "documents" d
    LEFT JOIN "document_versions" dv ON dv."id" = d."currentVersionId" AND dv."companyId" = u."companyId"
    WHERE d."id" = u."salesPlanDocumentId"
      AND d."status" = 'ACTIVE' AND d."storageStatus" = 'AVAILABLE'
      AND (d."mimeType" = 'application/pdf' OR regexp_replace(lower(coalesce(d."extension", '')), '^\.', '') = 'pdf')
      AND coalesce(d."currentVersionId", '') <> ''
  ) sp ON true
  -- The primary image counts only as an active, available JPEG, PNG or WebP with a current version.
  LEFT JOIN LATERAL (
    SELECT d."id", d."currentVersionId", m."category", m."caption"
    FROM "unit_media" m
    JOIN "documents" d ON d."id" = m."documentId"
    WHERE m."unitId" = u."id" AND m."isPrimary"
      AND d."status" = 'ACTIVE' AND d."storageStatus" = 'AVAILABLE'
      AND d."mimeType" IN ('image/jpeg', 'image/png', 'image/webp')
      AND coalesce(d."currentVersionId", '') <> ''
    LIMIT 1
  ) pm ON true
  WHERE u."publicationStatus" <> 'ARCHIVED'
),
"due" AS (
  -- No current version, or a live fact the fingerprint keeps differs from it.
  SELECT
    l.*,
    coalesce((SELECT max(x."versionNumber") FROM "unit_publications" x WHERE x."unitId" = l."unitId"), 0) + 1 AS "versionNumber",
    cp."versionNumber" AS "previousVersionNumber"
  FROM "live" l
  LEFT JOIN "unit_publications" cp ON cp."id" = l."currentPublicationId"
  WHERE cp."id" IS NULL
     OR (l."snapshot"->>'unitCode') IS DISTINCT FROM (cp."snapshot"->>'unitCode')
     OR (l."snapshot"->>'name') IS DISTINCT FROM (cp."snapshot"->>'name')
     OR (l."snapshot"#>>'{unitType,id}') IS DISTINCT FROM (cp."snapshot"#>>'{unitType,id}')
     OR (l."snapshot"#>>'{building,id}') IS DISTINCT FROM (cp."snapshot"#>>'{building,id}')
     OR (l."snapshot"#>>'{floor,id}') IS DISTINCT FROM (cp."snapshot"#>>'{floor,id}')
     OR (l."snapshot"->>'position') IS DISTINCT FROM (cp."snapshot"->>'position')
     OR (l."snapshot"->>'orientation') IS DISTINCT FROM (cp."snapshot"->>'orientation')
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY['internalArea', 'grossArea', 'saleableArea', 'outdoorArea', 'balconyArea', 'terraceArea', 'gardenArea', 'commonAreaAllocation']) AS a("field")
       WHERE round((l."snapshot"->'areas'->>a."field")::numeric, 2) IS DISTINCT FROM round((cp."snapshot"->'areas'->>a."field")::numeric, 2)
     )
     OR (l."snapshot"->>'rooms') IS DISTINCT FROM (cp."snapshot"->>'rooms')
     OR (l."snapshot"->>'bedrooms') IS DISTINCT FROM (cp."snapshot"->>'bedrooms')
     OR (l."snapshot"->>'bathrooms') IS DISTINCT FROM (cp."snapshot"->>'bathrooms')
     OR jsonb_strip_nulls(CASE WHEN jsonb_typeof(l."snapshot"->'attributes') = 'object' THEN l."snapshot"->'attributes' ELSE '{}'::jsonb END)
        IS DISTINCT FROM jsonb_strip_nulls(CASE WHEN jsonb_typeof(cp."snapshot"->'attributes') = 'object' THEN cp."snapshot"->'attributes' ELSE '{}'::jsonb END)
     OR (l."snapshot"->>'description') IS DISTINCT FROM (cp."snapshot"->>'description')
     OR (l."snapshot"#>>'{salesPlan,documentVersionId}') IS DISTINCT FROM (cp."snapshot"#>>'{salesPlan,documentVersionId}')
     OR (l."snapshot"#>>'{primaryImage,documentVersionId}') IS DISTINCT FROM (cp."snapshot"#>>'{primaryImage,documentVersionId}')
),
"inserted" AS (
  INSERT INTO "unit_publications" (
    "id", "companyId", "projectId", "unitId", "versionNumber", "publishedAt", "publishedByMemberId", "snapshot",
    "salesPlanDocumentId", "salesPlanDocumentVersionId", "primaryMediaDocumentId", "primaryMediaDocumentVersionId", "createdAt"
  )
  SELECT
    'upub_' || substr(md5(d."unitId" || ':' || d."versionNumber" || ':publish_on_create'), 1, 24),
    d."companyId", d."projectId", d."unitId", d."versionNumber", (now() AT TIME ZONE 'UTC'), NULL, d."snapshot",
    d."salesPlanDocumentId", d."salesPlanDocumentVersionId", d."primaryMediaDocumentId", d."primaryMediaDocumentVersionId", (now() AT TIME ZONE 'UTC')
  FROM "due" d
  RETURNING "id", "unitId", "versionNumber"
),
"pointed" AS (
  UPDATE "project_units" u
  SET
    "publicationStatus" = 'PUBLISHED',
    "publicationStatusChangedAt" = CASE WHEN u."publicationStatus" <> 'PUBLISHED' THEN (now() AT TIME ZONE 'UTC') ELSE u."publicationStatusChangedAt" END,
    "currentPublicationId" = coalesce(i."id", u."currentPublicationId"),
    "hasUnpublishedChanges" = false,
    "revisionReason" = NULL
  FROM "live" l
  LEFT JOIN "inserted" i ON i."unitId" = l."unitId"
  WHERE u."id" = l."unitId"
    AND (u."publicationStatus" <> 'PUBLISHED' OR i."id" IS NOT NULL OR u."hasUnpublishedChanges" OR u."revisionReason" IS NOT NULL)
  RETURNING u."id"
)
-- PROJECT_UNIT_PUBLISHED, as publishLiveUnits records it for the system.
INSERT INTO "audit_events" (
  "id", "companyId", "occurredAt", "actorType", "actorDisplayNameSnapshot", "moduleKey", "category", "severity", "actionKey",
  "entityType", "entityId", "entityLabelSnapshot", "projectId", "beforeJson", "afterJson", "changesJson", "metadataJson", "createdAt"
)
SELECT
  'audit_upub_' || substr(md5(i."id"), 1, 24),
  d."companyId",
  (now() AT TIME ZONE 'UTC'),
  'SYSTEM',
  'System (migration 20261109120000_units_publish_on_create)',
  'projects',
  'PROJECT',
  'IMPORTANT',
  'PROJECT_UNIT_PUBLISHED',
  'ProjectUnit',
  d."unitId",
  left(d."unitCode", 200),
  d."projectId",
  e."before",
  e."after",
  (
    SELECT jsonb_object_agg(k."key", jsonb_build_object('before', coalesce(e."before"->k."key", 'null'::jsonb), 'after', coalesce(e."after"->k."key", 'null'::jsonb)))
    FROM jsonb_object_keys(e."before" || e."after") AS k("key")
    WHERE coalesce(e."before"->k."key", 'null'::jsonb) IS DISTINCT FROM coalesce(e."after"->k."key", 'null'::jsonb)
  ),
  jsonb_build_object('automatic', true, 'migration', '20261109120000_units_publish_on_create'),
  (now() AT TIME ZONE 'UTC')
FROM "inserted" i
JOIN "due" d ON d."unitId" = i."unitId"
CROSS JOIN LATERAL (
  SELECT
    jsonb_build_object('publicationStatus', d."publicationStatus", 'versionNumber', d."previousVersionNumber") AS "before",
    jsonb_build_object(
      'publicationStatus', 'PUBLISHED',
      'versionNumber', i."versionNumber",
      'publicationId', i."id",
      'salesPlanDocumentVersionId', d."salesPlanDocumentVersionId",
      'primaryMediaDocumentVersionId', d."primaryMediaDocumentVersionId"
    ) AS "after"
) e
WHERE NOT EXISTS (SELECT 1 FROM "audit_events" x WHERE x."id" = 'audit_upub_' || substr(md5(i."id"), 1, 24));

-- 3. Cancel every open publishing request ------------------------------------

WITH "cancelled" AS (
  UPDATE "unit_publication_approvals" a
  SET "status" = 'CANCELLED', "decidedAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
  WHERE a."status" = 'PENDING'
  RETURNING a."id", a."companyId", a."recordId"
),
"resolved" AS (
  -- The request's attention items (their dedupe key carries the request's id), and nothing else the unit has open.
  -- A data-modifying WITH runs to completion whether or not the main query reads it.
  UPDATE "attention_items" ai
  SET "status" = 'RESOLVED', "resolvedAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
  FROM "cancelled" c
  WHERE ai."companyId" = c."companyId"
    AND ai."entityType" = 'project_unit'
    AND ai."entityId" = c."recordId"
    AND ai."conditionKey" IN ('PENDING_APPROVAL', 'PROCUREMENT_ACTION_REQUIRED', 'APPROVAL_OVERDUE')
    AND ai."status" = 'ACTIVE'
    AND position(c."id" IN ai."dedupeKey") > 0
  RETURNING ai."id"
)
-- APPROVAL_CANCELLED, one per unit, as recordApprovalCancelled records it.
INSERT INTO "audit_events" (
  "id", "companyId", "occurredAt", "actorType", "actorDisplayNameSnapshot", "moduleKey", "category", "severity", "actionKey",
  "entityType", "entityId", "entityLabelSnapshot", "changesJson", "metadataJson", "createdAt"
)
SELECT
  'audit_upcx_' || substr(md5(c."companyId" || ':' || c."recordId" || ':publish_on_create'), 1, 24),
  c."companyId",
  (now() AT TIME ZONE 'UTC'),
  'SYSTEM',
  'System (migration 20261109120000_units_publish_on_create)',
  'approvals',
  'APPROVAL',
  'INFO',
  'APPROVAL_CANCELLED',
  'project_unit',
  c."recordId",
  'Unit',
  jsonb_build_object(
    'providerKey', jsonb_build_object('before', 'null'::jsonb, 'after', 'projects'),
    'sourceType', jsonb_build_object('before', 'null'::jsonb, 'after', 'project_unit'),
    'count', jsonb_build_object('before', 'null'::jsonb, 'after', count(*))
  ),
  jsonb_build_object('migration', '20261109120000_units_publish_on_create'),
  (now() AT TIME ZONE 'UTC')
FROM "cancelled" c
GROUP BY c."companyId", c."recordId";
