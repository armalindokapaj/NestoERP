import { redirect } from "next/navigation";

import { requireSettingsSection } from "../settings-access";

/**
 * Company Settings → Users (CEO Users & Roles §5).
 *
 * There is one place a company administers its users: the Team module, which
 * lists, searches and filters the company's memberships and holds the invite,
 * invitation, edit and deactivation flows. This section is its door from
 * Company Settings, not a second list.
 */
export default async function UsersSettingsPage() {
  await requireSettingsSection("users");
  redirect("/team");
}
