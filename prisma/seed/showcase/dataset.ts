/**
 * Arvela Group — the selling demo's group of companies (2026-11-13).
 *
 * Invented from end to end: the group, its ten companies, their projects and
 * all 46 people. Registry numbers start with X, which no Albanian NIPT does,
 * and every mail and web address ends in `.test`, so nothing here can be
 * mistaken for, or reach, a real company or person.
 *
 * The standard demo seed builds a group of five companies with every module in
 * use; this dataset re-dresses it as Arvela and adds the companies and projects
 * the standard seed has no slot for. Record ids stay the standard seed's
 * (`company_demo_a`, `project_a`, `user_ceo`), so every record keeps its links.
 */

export const SHOWCASE_GROUP = {
  id: "group_demo_nesto",
  slug: "arvela-group",
  name: "Arvela Group",
  legalName: "Arvela Group sh.a.",
  registrationNumber: "X00000000A",
  city: "Tirana",
  country: "Albania",
} as const;

export type ShowcaseCompany = {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  nipt: string;
  industry: string | null;
  address: string;
  /** Mail and web domain, `.test`: nothing can ever be delivered. */
  domain: string;
};

/** The standard seed's five companies, re-dressed: the ones with a project and a year of work. */
export const SHOWCASE_COMPANIES: Record<"a" | "b" | "c" | "d" | "e", ShowcaseCompany & { was: { name: string; legalName: string; domain: string; word: string } }> = {
  a: {
    id: "company_demo_a", slug: "arvela-ndertim", name: "Arvela Ndërtim", legalName: "Arvela Ndërtim sh.p.k.", nipt: "X00000001A",
    industry: "Construction", address: "Rruga e Durrësit 42, Tiranë 1001", domain: "ndertim.arvela.test",
    was: { name: "Aurelia Construction", legalName: "Aurelia Construction sh.p.k.", domain: "aurelia.test", word: "Aurelia" },
  },
  b: {
    id: "company_demo_b", slug: "arvela-developments", name: "Arvela Developments", legalName: "Arvela Developments sh.p.k.", nipt: "X00000002B",
    industry: "Real estate development", address: "Bulevardi Dyrrah 15, Durrës 2001", domain: "developments.arvela.test",
    was: { name: "Meridian Developments", legalName: "Meridian Developments sh.p.k.", domain: "meridian.test", word: "Meridian" },
  },
  c: {
    id: "company_demo_c", slug: "arvela-infrastruktura", name: "Arvela Infrastruktura", legalName: "Arvela Infrastruktura sh.p.k.", nipt: "X00000003C",
    industry: "Infrastructure and civil works", address: "Autostrada Tiranë–Durrës km 9, Vorë 1032", domain: "infrastruktura.arvela.test",
    was: { name: "Terra Infrastructure", legalName: "Terra Infrastructure sh.p.k.", domain: "terra.test", word: "Terra" },
  },
  d: {
    id: "company_demo_d", slug: "arvela-inxhinieri", name: "Arvela Inxhinieri", legalName: "Arvela Inxhinieri sh.p.k.", nipt: "X00000004D",
    industry: "Engineering and construction", address: "Rruga Ismail Qemali 7, Vlorë 9401", domain: "inxhinieri.arvela.test",
    was: { name: "Forma Engineering", legalName: "Forma Engineering sh.p.k.", domain: "forma.test", word: "Forma" },
  },
  e: {
    id: "company_demo_e", slug: "arvela-hospitality", name: "Arvela Hospitality", legalName: "Arvela Hospitality sh.p.k.", nipt: "X00000005E",
    industry: "Hospitality development", address: "Rruga Butrinti 3, Sarandë 9701", domain: "hospitality.arvela.test",
    was: { name: "Nova Hospitality Development", legalName: "Nova Hospitality Development sh.p.k.", domain: "nova.test", word: "Nova Hospitality" },
  },
};

/** The group's other companies: their details and their head, no history of their own. */
export const SHOWCASE_EXTRA_COMPANIES: Array<ShowcaseCompany & { head: string | null; documentsOnly?: boolean }> = [
  { id: "company_showcase_energji", slug: "arvela-energji", name: "Arvela Energji", legalName: "Arvela Energji sh.p.k.", nipt: "X00000006F", industry: "Energy", address: "Rruga e Kavajës 210, Tiranë 1023", domain: "energji.arvela.test", head: "user_showcase_blerina_dushku" },
  { id: "company_showcase_pronat", slug: "arvela-pronat", name: "Arvela Pronat", legalName: "Arvela Pronat sh.p.k.", nipt: "X00000007G", industry: "Property management", address: "Rruga e Durrësit 42, Tiranë 1001", domain: "pronat.arvela.test", head: "user_showcase_agron_mullaj" },
  { id: "company_showcase_betoni", slug: "arvela-betoni", name: "Arvela Betoni", legalName: "Arvela Betoni sh.p.k.", nipt: "X00000008H", industry: "Concrete and building materials", address: "Zona Industriale, Fushë-Krujë 1502", domain: "betoni.arvela.test", head: "user_showcase_marsela_kote" },
  { id: "company_showcase_pajisje", slug: "arvela-pajisje", name: "Arvela Pajisje", legalName: "Arvela Pajisje sh.p.k.", nipt: "X00000009J", industry: "Equipment rental", address: "Rruga Kashar–Vorë 18, Kashar 1051", domain: "pajisje.arvela.test", head: "user_showcase_ylli_shkreli" },
  { id: "company_showcase_fondacioni", slug: "arvela-fondacioni", name: "Fondacioni Arvela", legalName: "Fondacioni Arvela", nipt: "X00000010K", industry: "Foundation", address: "Rruga e Durrësit 42, Tiranë 1001", domain: "fondacioni.arvela.test", head: "user_showcase_doruntina_lami", documentsOnly: true },
];

export type ShowcaseProjectPlace = {
  name: string;
  code: string;
  description: string;
  type: "Residential" | "Commercial" | "Hotel" | "Mixed use" | "Industrial";
  address: string | null;
  city: string;
  builtArea: number | null;
};

/** The standard seed's five projects, as Arvela's own. */
export const SHOWCASE_PROJECTS: Record<string, ShowcaseProjectPlace & { was: { name: string; code: string } }> = {
  project_a: {
    name: "Kalaja Residence", code: "KAL", type: "Mixed use", address: "Rruga e Durrësit", city: "Tirana", builtArea: 64000,
    description: "Three blocks of 96 apartments over shops and two basement levels in central Tirana; about 64,000 m².",
    was: { name: "Riverside Residences", code: "A-PRJ-001" },
  },
  project_b: {
    name: "Porta Tower", code: "PRT", type: "Commercial", address: "Bulevardi Dyrrah", city: "Durrës", builtArea: 38000,
    description: "Eighteen floors of offices with two basement levels by the port of Durrës; about 38,000 m².",
    was: { name: "Central Office Tower", code: "B-PRJ-001" },
  },
  project_c: {
    name: "Nyja Logistics Park", code: "NYJ", type: "Industrial", address: "Autostrada Tiranë–Durrës km 9", city: "Vorë", builtArea: 52000,
    description: "Distribution centre and vehicle yard on the Tirana–Durrës highway, working through its permits; about 52,000 m².",
    was: { name: "East Gate Logistics Hub", code: "C-PRJ-001" },
  },
  project_d: {
    name: "Lungomare Apartments", code: "LGM", type: "Residential", address: "Lungomare", city: "Vlorë", builtArea: 27000,
    description: "Waterfront apartments with a public promenade on Vlorë's Lungomare; about 27,000 m².",
    was: { name: "Marina Apartments", code: "D-PRJ-001" },
  },
  project_e: {
    name: "Ksamil Bay Hotel & Residences", code: "KSB", type: "Hotel", address: "Ksamil", city: "Sarandë", builtArea: 41000,
    description: "A 140-room seafront hotel with serviced residences and a row of shops in Ksamil; about 41,000 m².",
    was: { name: "Adriatic Hotel & Residences", code: "E-PRJ-001" },
  },
};

/** Arvela Developments' other projects: in the portfolio with their place, without a history of their own. */
export const SHOWCASE_EXTRA_PROJECTS: Array<ShowcaseProjectPlace & { id: string; companyId: string; status: "ACTIVE" | "PENDING" | "FINISHED" }> = [
  {
    id: "project_showcase_promenada", companyId: "company_demo_b", status: "ACTIVE", name: "Promenada Durrës", code: "PRD", type: "Mixed use", address: "Rruga Taulantia", city: "Durrës", builtArea: 45000,
    description: "Apartments and seafront shops on Durrës promenade; about 45,000 m², 2025–2028.",
  },
  {
    id: "project_showcase_kodra", companyId: "company_demo_b", status: "FINISHED", name: "Kodra Villas", code: "KDV", type: "Residential", address: "Kodra e Diellit", city: "Tirana", builtArea: 9800,
    description: "Twenty-four villas on the hills above Tirana; about 9,800 m², handed over in 2023.",
  },
  {
    id: "project_showcase_rinas", companyId: "company_demo_b", status: "PENDING", name: "Rinas Business Park", code: "RBP", type: "Commercial", address: "Rruga e Aeroportit", city: "Rinas", builtArea: 30000,
    description: "Offices and showrooms by the airport road, in design; about 30,000 m².",
  },
];

export type ShowcasePerson = { firstName: string; lastName: string; jobTitle?: string };

/**
 * Who each standard seed account becomes: every person invented. Accounts not
 * listed keep their invented names.
 */
export const SHOWCASE_PEOPLE: Record<string, ShowcasePerson & { was: string }> = {
  user_admin: { firstName: "NESTO", lastName: "Admin", was: "Adam Hart" },
  user_owner: { firstName: "Luan", lastName: "Kelmendi", jobTitle: "Group Owner", was: "Olivia Owner" },
  user_it: { firstName: "Ergys", lastName: "Hoxha", was: "Ian Carter" },
  user_hr: { firstName: "Elira", lastName: "Kola", was: "Hannah Reed" },
  user_architecture_manager: { firstName: "Besnik", lastName: "Dardha", was: "Marco Bellini" },
  user_finance: { firstName: "Anila", lastName: "Gjoni", was: "Fiona Blake" },
  user_legal: { firstName: "Ornela", lastName: "Prifti", was: "Laura Stein" },
  user_sales_manager: { firstName: "Denisa", lastName: "Leka", was: "Nora Hale" },
  user_procurement: { firstName: "Artan", lastName: "Hysi", was: "Peter Nolan" },
  user_inventory: { firstName: "Ilir", lastName: "Bushati", was: "Isaac Turner" },
  user_qaqc: { firstName: "Arjola", lastName: "Meta", was: "Quinn Foster" },
  user_hse: { firstName: "Fatmir", lastName: "Zeka", was: "Henry Stone" },
  user_ceo: { firstName: "Genci", lastName: "Hasani", was: "Charles Morgan" },
  user_pm: { firstName: "Erion", lastName: "Daci", was: "Alex Morgan" },
  user_architect: { firstName: "Eriona", lastName: "Kastrati", was: "Anna Rossi" },
  user_engineer: { firstName: "Andi", lastName: "Gashi", was: "Ethan Cole" },
  user_sales: { firstName: "Megi", lastName: "Ruci", was: "Sophie Grant" },
  user_viewer: { firstName: "Sokol", lastName: "Bardhi", was: "Victor Lane" },
  user_multicompany: { firstName: "Lindita", lastName: "Rama", was: "Mia Vogel" },
};

/** The heads of the companies the standard seed has no slot for. */
export const SHOWCASE_NEW_PEOPLE: Array<ShowcasePerson & { id: string; jobTitle: string }> = [
  { id: "user_showcase_blerina_dushku", firstName: "Blerina", lastName: "Dushku", jobTitle: "Chief Executive Officer" },
  { id: "user_showcase_agron_mullaj", firstName: "Agron", lastName: "Mullaj", jobTitle: "Chief Executive Officer" },
  { id: "user_showcase_marsela_kote", firstName: "Marsela", lastName: "Kote", jobTitle: "Chief Executive Officer" },
  { id: "user_showcase_ylli_shkreli", firstName: "Ylli", lastName: "Shkreli", jobTitle: "Chief Executive Officer" },
  { id: "user_showcase_doruntina_lami", firstName: "Doruntina", lastName: "Lami", jobTitle: "Director" },
];

/** A sign-in name from a person's name: `erion.daci`. */
export function usernameOf(person: ShowcasePerson): string {
  const ascii = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ç/gi, "c").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${ascii(person.firstName)}.${ascii(person.lastName)}`;
}

/** The demo's people write from one invented domain, so no message can reach a real mailbox. */
export const SHOWCASE_EMAIL_DOMAIN = "arvela.test";

/**
 * Prose the standard seed wrote with its own names — task titles, notes, posts,
 * file names — and what it says now, longest first so a company's legal name
 * goes before its short one. `word` matches only a whole word, so "Forma" never
 * touches "Format".
 */
export function showcaseReplacements(): Array<{ old: string; new: string; word?: boolean }> {
  const pairs: Array<{ old: string; new: string; word?: boolean }> = [
    { old: "NESTO Demo Group sh.a.", new: SHOWCASE_GROUP.legalName },
    { old: "NESTO Demo Group", new: SHOWCASE_GROUP.name },
  ];
  for (const company of Object.values(SHOWCASE_COMPANIES)) {
    pairs.push({ old: company.was.legalName, new: company.legalName }, { old: company.was.name, new: company.name }, { old: company.was.domain, new: company.domain });
  }
  for (const project of Object.values(SHOWCASE_PROJECTS)) {
    pairs.push({ old: project.was.name, new: project.name }, { old: project.was.code, new: project.code });
  }
  for (const person of Object.values(SHOWCASE_PEOPLE)) {
    const now = `${person.firstName} ${person.lastName}`;
    if (person.was !== now) pairs.push({ old: person.was, new: now });
  }
  pairs.push({ old: "@nesto.test", new: `@${SHOWCASE_EMAIL_DOMAIN}` });
  // The short forms last, whole words only.
  for (const company of Object.values(SHOWCASE_COMPANIES)) pairs.push({ old: company.was.word, new: company.name, word: true });
  return pairs.sort((a, b) => Number(Boolean(a.word)) - Number(Boolean(b.word)) || b.old.length - a.old.length);
}
