import { redirect } from "next/navigation";

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Notifications moved into the Activity Center (Activity Center §4, §164).
 * `/notifications/:id/open` stays: it is the re-authorising link every
 * notification carries, old and new (§163).
 */
export default async function NotificationsPage({ searchParams }: Params) {
  const params = await searchParams;
  redirect(params.tab === "unread" ? "/activity?type=notifications&readState=UNREAD" : "/activity?type=notifications");
}
