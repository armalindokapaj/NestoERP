-- Units: net area and storage; name, position and rooms retired (2026-11-09).
--
-- The net area is internal + balcony + terrace; the gross area is net + the
-- common area allocation. Both are worked out on every save from now on
-- (structure.rules `workedOutAreas`); this fills them in for the units that
-- exist. Land keeps the gross area it was given: it has no internal area to
-- add up. A sum of nothing is NULL, never 0.

ALTER TABLE "project_units" ADD COLUMN "netArea" DECIMAL(12,2);
ALTER TABLE "project_units" ADD COLUMN "storage" INTEGER;

-- A gross area that was typed above the net area, with no common area
-- allocation, keeps its value: the difference becomes the allocation. (Unit 501
-- on production: 52.68 internal + 12.04 balcony = 64.72 net; 80.66 gross typed;
-- 15.94 allocation.)
UPDATE "project_units" AS u
SET "commonAreaAllocation" = u."grossArea" - (COALESCE(u."internalArea", 0) + COALESCE(u."balconyArea", 0) + COALESCE(u."terraceArea", 0))
FROM "project_unit_types" AS t
WHERE t."id" = u."unitTypeId"
  AND t."category" <> 'LAND'
  AND u."commonAreaAllocation" IS NULL
  AND u."grossArea" IS NOT NULL
  AND (u."internalArea" IS NOT NULL OR u."balconyArea" IS NOT NULL OR u."terraceArea" IS NOT NULL)
  AND u."grossArea" > COALESCE(u."internalArea", 0) + COALESCE(u."balconyArea", 0) + COALESCE(u."terraceArea", 0);

UPDATE "project_units"
SET "netArea" = COALESCE("internalArea", 0) + COALESCE("balconyArea", 0) + COALESCE("terraceArea", 0)
WHERE "internalArea" IS NOT NULL OR "balconyArea" IS NOT NULL OR "terraceArea" IS NOT NULL;

-- A unit with neither a net area nor an allocation keeps whatever gross area it
-- has until it is next saved (none on production on 2026-11-09).
UPDATE "project_units" AS u
SET "grossArea" = COALESCE(u."netArea", 0) + COALESCE(u."commonAreaAllocation", 0)
FROM "project_unit_types" AS t
WHERE t."id" = u."unitTypeId"
  AND t."category" <> 'LAND'
  AND (u."netArea" IS NOT NULL OR u."commonAreaAllocation" IS NOT NULL);

-- No form sets a name, a position or a room count any more; none is kept, so
-- none shows up in a version published from now on. (Production had none.)
UPDATE "project_units"
SET "name" = NULL, "position" = NULL, "rooms" = NULL
WHERE "name" IS NOT NULL OR "position" IS NOT NULL OR "rooms" IS NOT NULL;

-- Publish what changed --------------------------------------------------------
--
-- Units publish what they are at once (20261109120000_units_publish_on_create),
-- so a correction made here goes live the way an edit does: every unit in use
-- whose live facts now differ from its current version by the publish
-- fingerprint gets its next version (max + 1), with exactly the snapshot
-- `buildSnapshot` writes — now with the net area and the storage count — as
-- the system's, with no member. Archived units are left as they are. Ids are
-- derived from the rows, with their own salt, so they never meet the earlier
-- backfill's; timestamps are UTC.

WITH "live" AS (
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
      'areas', jsonb_build_object(
        'internalArea', u."internalArea"::text,
        'balconyArea', u."balconyArea"::text,
        'terraceArea', u."terraceArea"::text,
        'netArea', u."netArea"::text,
        'commonAreaAllocation', u."commonAreaAllocation"::text,
        'grossArea', u."grossArea"::text,
        'saleableArea', u."saleableArea"::text,
        'outdoorArea', u."outdoorArea"::text,
        'gardenArea', u."gardenArea"::text
      ),
      'rooms', u."rooms",
      'bedrooms', u."bedrooms",
      'bathrooms', u."bathrooms",
      'storage', u."storage",
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
  LEFT JOIN LATERAL (
    SELECT d."id", d."currentVersionId", d."originalFileName", dv."versionNumber"
    FROM "documents" d
    LEFT JOIN "document_versions" dv ON dv."id" = d."currentVersionId" AND dv."companyId" = u."companyId"
    WHERE d."id" = u."salesPlanDocumentId"
      AND d."status" = 'ACTIVE' AND d."storageStatus" = 'AVAILABLE'
      AND (d."mimeType" = 'application/pdf' OR regexp_replace(lower(coalesce(d."extension", '')), '^\.', '') = 'pdf')
      AND coalesce(d."currentVersionId", '') <> ''
  ) sp ON true
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
  -- No current version, or a live fact the fingerprint keeps differs from it. A
  -- version written before the net area and the storage count existed has
  -- neither: missing reads as null, as it does in `publishFingerprint`.
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
       SELECT 1 FROM unnest(ARRAY['internalArea', 'balconyArea', 'terraceArea', 'netArea', 'commonAreaAllocation', 'grossArea', 'saleableArea', 'outdoorArea', 'gardenArea']) AS a("field")
       WHERE round((l."snapshot"->'areas'->>a."field")::numeric, 2) IS DISTINCT FROM round((cp."snapshot"->'areas'->>a."field")::numeric, 2)
     )
     OR (l."snapshot"->>'rooms') IS DISTINCT FROM (cp."snapshot"->>'rooms')
     OR (l."snapshot"->>'bedrooms') IS DISTINCT FROM (cp."snapshot"->>'bedrooms')
     OR (l."snapshot"->>'bathrooms') IS DISTINCT FROM (cp."snapshot"->>'bathrooms')
     OR (l."snapshot"->>'storage') IS DISTINCT FROM (cp."snapshot"->>'storage')
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
    'upub_' || substr(md5(d."unitId" || ':' || d."versionNumber" || ':net_area_storage'), 1, 24),
    d."companyId", d."projectId", d."unitId", d."versionNumber", (now() AT TIME ZONE 'UTC'), NULL, d."snapshot",
    d."salesPlanDocumentId", d."salesPlanDocumentVersionId", d."primaryMediaDocumentId", d."primaryMediaDocumentVersionId", (now() AT TIME ZONE 'UTC')
  FROM "due" d
  RETURNING "id", "unitId", "versionNumber"
),
"pointed" AS (
  -- The unit stays as it is; only its pointer moves (and a unit the earlier
  -- backfill could not reach is published now, as that backfill would have).
  UPDATE "project_units" u
  SET
    "publicationStatus" = 'PUBLISHED',
    "publicationStatusChangedAt" = CASE WHEN u."publicationStatus" <> 'PUBLISHED' THEN (now() AT TIME ZONE 'UTC') ELSE u."publicationStatusChangedAt" END,
    "currentPublicationId" = i."id",
    "hasUnpublishedChanges" = false,
    "revisionReason" = NULL
  FROM "inserted" i
  WHERE u."id" = i."unitId"
  RETURNING u."id"
)
INSERT INTO "audit_events" (
  "id", "companyId", "occurredAt", "actorType", "actorDisplayNameSnapshot", "moduleKey", "category", "severity", "actionKey",
  "entityType", "entityId", "entityLabelSnapshot", "projectId", "beforeJson", "afterJson", "changesJson", "metadataJson", "createdAt"
)
SELECT
  'audit_upub_' || substr(md5(i."id"), 1, 24),
  d."companyId",
  (now() AT TIME ZONE 'UTC'),
  'SYSTEM',
  'System (migration 20261109160000_unit_net_area_storage)',
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
  jsonb_build_object('automatic', true, 'migration', '20261109160000_unit_net_area_storage'),
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
