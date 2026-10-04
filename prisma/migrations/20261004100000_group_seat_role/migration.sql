-- A group seat carries its own group-level role (Admin PRD #9), so a person can
-- belong to a parent group with no company membership. Additive and nullable;
-- existing seats take the group role they already hold through their companies.
ALTER TABLE "parent_group_members" ADD COLUMN "roleId" TEXT;

ALTER TABLE "parent_group_members"
  ADD CONSTRAINT "parent_group_members_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "parent_group_members_roleId_idx" ON "parent_group_members"("roleId");

UPDATE "parent_group_members" AS seat
SET "roleId" = (
  SELECT member."roleId"
  FROM "company_members" AS member
  JOIN "roles" AS role ON role."id" = member."roleId"
  JOIN "companies" AS company ON company."id" = member."companyId"
  WHERE member."userId" = seat."userId"
    AND company."parentGroupId" = seat."parentGroupId"
    AND member."status" = 'ACTIVE'
    AND role."key" IN ('OWNER', 'GROUP_IT')
  ORDER BY (role."key" = 'OWNER') DESC, member."createdAt" ASC
  LIMIT 1
);
