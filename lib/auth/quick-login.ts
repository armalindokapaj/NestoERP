import { DEMO_PASSWORD } from "@/config/demo-accounts";
import { prisma } from "@/lib/database/prisma";

/**
 * UI/UX test branch only: the seeded demo people, grouped for the sign-in
 * screen's quick login. Reads the demo group (never a test fixture) and returns
 * names and usernames — the password stays on the server.
 */
export type QuickLoginPerson = { username: string; name: string; title: string; role: string };
export type QuickLoginSection = { name: string; people: QuickLoginPerson[] };

export const QUICK_LOGIN_PASSWORD = DEMO_PASSWORD;

/** The demo people's mail domain: a hosted demo dressed as a customer has its own (NESTO_DEMO_EMAIL_DOMAIN). */
const DEMO_EMAIL_DOMAIN = `@${process.env.NESTO_DEMO_EMAIL_DOMAIN ?? "nesto.test"}`;

export async function quickLoginSections(): Promise<QuickLoginSection[]> {
  // A demo whose people choose their own password at first sign-in has no one-click sign-in to offer.
  if (process.env.NESTO_DEMO_SIGN_IN === "temporary") return [];
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", email: { endsWith: DEMO_EMAIL_DOMAIN } },
    orderBy: { username: "asc" },
    select: {
      username: true,
      firstName: true,
      lastName: true,
      parentGroupMemberships: {
        where: { status: "ACTIVE", parentGroup: { isTestFixture: false, deletedAt: null } },
        select: { role: { select: { name: true } } },
      },
      memberships: {
        where: { status: "ACTIVE", company: { parentGroup: { isTestFixture: false } } },
        orderBy: { createdAt: "asc" },
        select: { jobTitle: true, role: { select: { name: true } }, company: { select: { name: true } } },
      },
    },
  });

  const sections = new Map<string, QuickLoginPerson[]>();
  const add = (section: string, person: QuickLoginPerson) => {
    sections.set(section, [...(sections.get(section) ?? []), person]);
  };

  for (const user of users) {
    const name = `${user.firstName} ${user.lastName}`;
    const first = user.memberships[0];
    const seat = user.parentGroupMemberships[0];
    if (seat) {
      add("Group", { username: user.username, name, title: first?.jobTitle ?? seat.role?.name ?? "Group", role: seat.role?.name ?? "Group" });
    } else if (first) {
      add(first.company.name, { username: user.username, name, title: first.jobTitle ?? first.role.name, role: first.role.name });
    } else if (user.username === "platform-admin") {
      add("Platform", { username: user.username, name, title: "Platform Administrator", role: "Platform Admin" });
    }
  }

  const order = (name: string) => (name === "Platform" ? 0 : name === "Group" ? 1 : 2);
  return [...sections.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([name, people]) => ({ name, people }));
}
