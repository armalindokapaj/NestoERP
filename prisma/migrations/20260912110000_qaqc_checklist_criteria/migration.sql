-- The checklist snapshot carries its own pass criterion (PRD #21 §69).
--
-- Without it, a completed inspection can only say whether a check passed, not
-- what it was held to — which the template may since have changed.
ALTER TABLE "inspection_checklist_items" ADD COLUMN "passCriteriaText" TEXT;
