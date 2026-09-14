import { cache } from "react";
import { notFound } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { getMeeting } from "@/lib/modules/meetings/meeting.service";

/**
 * One meeting for one request, shared by the page, its metadata and its
 * sub-pages. A meeting the reader cannot open is a 404 — the same answer as a
 * meeting that does not exist (PRD #40 §231).
 */
export const loadMeeting = cache(async (meetingId: string) => {
  const context = await requireModule("meetings");
  try {
    return { context, meeting: await getMeeting(context, meetingId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});
