import { redirect } from "next/navigation";

export default function SecuritySessionsPage() {
  redirect("/platform-admin/access/sessions");
}
