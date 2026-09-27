-- Every company starts with the default unit types (config/unit-types.ts,
-- E-05B §20, §21): company bootstrap creates them, and migration
-- 20260917120000_project_structure_e05b wrote them for the companies that
-- existed then. Companies a seed created afterwards without bootstrap have
-- none, so no project of theirs can have units — not in Projects, and not from
-- a 3D Experience's structure, which then has nothing to link its unit blocks
-- to. Only a company with no unit type at all gets the defaults; a company's
-- own list is never touched. Data only: no schema change.
INSERT INTO "project_unit_types" ("id", "companyId", "name", "code", "category", "sortOrder", "createdAt", "updatedAt")
SELECT 'utype_' || substr(md5(c."id" || ':' || d."code"), 1, 24), c."id", d."name", d."code", d."category"::"UnitTypeCategory", d."sortOrder", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" AS c
CROSS JOIN (
  VALUES
    ('Apartment', 'APARTMENT', 'RESIDENTIAL', 1),
    ('Penthouse', 'PENTHOUSE', 'RESIDENTIAL', 2),
    ('Villa', 'VILLA', 'RESIDENTIAL', 3),
    ('Office', 'OFFICE', 'COMMERCIAL', 4),
    ('Shop', 'SHOP', 'COMMERCIAL', 5),
    ('Parking', 'PARKING', 'PARKING', 6),
    ('Garage', 'GARAGE', 'PARKING', 7),
    ('Storage', 'STORAGE', 'STORAGE', 8),
    ('Land', 'LAND', 'LAND', 9),
    ('Other', 'OTHER', 'OTHER', 10)
) AS d("name", "code", "category", "sortOrder")
WHERE NOT EXISTS (SELECT 1 FROM "project_unit_types" AS t WHERE t."companyId" = c."id")
ON CONFLICT DO NOTHING;
