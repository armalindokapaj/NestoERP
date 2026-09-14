-- A reminder belongs to exactly one thing: a calendar event or a meeting (PRD #40 §188).
ALTER TABLE "calendar_reminders"
  ADD CONSTRAINT "calendar_reminders_one_parent" CHECK (("eventId" IS NULL) <> ("meetingId" IS NULL));
