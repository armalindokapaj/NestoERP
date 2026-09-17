/**
 * The demo group, its five companies and their one project each (E-06 §42-§44,
 * §106).
 *
 * The one source of truth every demo seed module reads: a record on a project
 * takes its company from here, never from a constant of its own, so nothing is
 * ever created with Company A's id and Company C's project (E-06 §105).
 */

export const DEMO_GROUP = {
  id: "group_demo_nesto",
  slug: "nesto-demo-group",
  name: "NESTO Demo Group",
  legalName: "NESTO Demo Group sh.a.",
  country: "Albania",
  timezone: "Europe/Tirane",
  currency: "EUR",
} as const;

export type DemoCompanyCode = "a" | "b" | "c" | "d" | "e";

export const DEMO_COMPANIES = {
  a: {
    id: "company_demo_a",
    slug: "aurelia-construction",
    name: "Aurelia Construction",
    legalName: "Aurelia Construction sh.p.k.",
    industry: "Construction & General Contracting",
    city: "Tiranë",
    address: "Rruga e Kavajës 118, Tiranë 1001",
    email: "hello@aurelia.test",
    phone: "+355 4 200 0000",
    website: "https://aurelia.test",
  },
  b: {
    id: "company_demo_b",
    slug: "meridian-developments",
    name: "Meridian Developments",
    legalName: "Meridian Developments sh.p.k.",
    industry: "Real Estate Development",
    city: "Durrës",
    address: "Bulevardi Epidamn 22, Durrës 2001",
    email: "hello@meridian.test",
    phone: "+355 52 200 000",
    website: "https://meridian.test",
  },
  c: {
    id: "company_demo_c",
    slug: "terra-infrastructure",
    name: "Terra Infrastructure",
    legalName: "Terra Infrastructure sh.p.k.",
    industry: "Infrastructure & Civil Works",
    city: "Tiranë",
    address: "Autostrada Tiranë–Durrës km 7, Tiranë 1051",
    email: "hello@terra.test",
    phone: "+355 4 230 0000",
    website: "https://terra.test",
  },
  d: {
    id: "company_demo_d",
    slug: "forma-engineering",
    name: "Forma Engineering",
    legalName: "Forma Engineering sh.p.k.",
    industry: "Engineering & Construction",
    city: "Vlorë",
    address: "Lungomare 4, Vlorë 9401",
    email: "hello@forma.test",
    phone: "+355 33 200 000",
    website: "https://forma.test",
  },
  e: {
    id: "company_demo_e",
    slug: "nova-hospitality-development",
    name: "Nova Hospitality Development",
    legalName: "Nova Hospitality Development sh.p.k.",
    industry: "Hospitality Development",
    city: "Sarandë",
    address: "Rruga Jonianët 9, Sarandë 9701",
    email: "hello@nova.test",
    phone: "+355 85 200 000",
    website: "https://nova.test",
  },
} as const satisfies Record<DemoCompanyCode, Record<string, string>>;

export const DEMO_COMPANY_CODES = Object.keys(DEMO_COMPANIES) as DemoCompanyCode[];

/** Every demo company id, Aurelia first. */
export const DEMO_COMPANY_IDS: string[] = DEMO_COMPANY_CODES.map((code) => DEMO_COMPANIES[code].id);

/** A demo company's details by id. */
export function demoCompany(companyId: string) {
  return DEMO_COMPANIES[companyCode(companyId)];
}

export const COMPANY_A = DEMO_COMPANIES.a.id;
export const COMPANY_B = DEMO_COMPANIES.b.id;
export const COMPANY_C = DEMO_COMPANIES.c.id;
export const COMPANY_D = DEMO_COMPANIES.d.id;
export const COMPANY_E = DEMO_COMPANIES.e.id;

export const DEMO_PROJECTS = {
  a: { id: "project_a", companyId: COMPANY_A, code: "A-PRJ-001", name: "Riverside Residences" },
  b: { id: "project_b", companyId: COMPANY_B, code: "B-PRJ-001", name: "Central Office Tower" },
  c: { id: "project_c", companyId: COMPANY_C, code: "C-PRJ-001", name: "East Gate Logistics Hub" },
  d: { id: "project_d", companyId: COMPANY_D, code: "D-PRJ-001", name: "Marina Apartments" },
  e: { id: "project_e", companyId: COMPANY_E, code: "E-PRJ-001", name: "Adriatic Hotel & Residences" },
} as const satisfies Record<DemoCompanyCode, { id: string; companyId: string; code: string; name: string }>;

export const PROJECT_IDS = {
  a: DEMO_PROJECTS.a.id,
  b: DEMO_PROJECTS.b.id,
  c: DEMO_PROJECTS.c.id,
  d: DEMO_PROJECTS.d.id,
  e: DEMO_PROJECTS.e.id,
} as const;

const COMPANY_BY_PROJECT = new Map<string, string>(Object.values(DEMO_PROJECTS).map((project) => [project.id, project.companyId]));

/** The company a demo project belongs to. An unknown id is a seed bug, not a default. */
export function companyOfProject(projectId: string): string {
  const companyId = COMPANY_BY_PROJECT.get(projectId);
  if (!companyId) throw new Error(`Seed: ${projectId} is not a demo project.`);
  return companyId;
}

/** The company letter of a demo company id: "company_demo_c" → "c". */
export function companyCode(companyId: string): DemoCompanyCode {
  const entry = (Object.entries(DEMO_COMPANIES) as Array<[DemoCompanyCode, { id: string }]>).find(([, company]) => company.id === companyId);
  if (!entry) throw new Error(`Seed: ${companyId} is not a demo company.`);
  return entry[0];
}

/**
 * The company each demo client belongs to: the company of the project it
 * commissioned, or Aurelia for the ones with no project. A record naming a
 * client is created in the client's company (E-06 §105).
 */
export const CLIENT_COMPANY: Record<string, string> = {
  client_acme: COMPANY_A,
  client_nova: COMPANY_A,
  client_elena: COMPANY_A,
  client_archive: COMPANY_A,
  client_beta: COMPANY_B,
  client_delta: COMPANY_B,
  client_atlas: COMPANY_C,
  client_municipality: COMPANY_C,
  client_meridian: COMPANY_D,
  client_horizon: COMPANY_D,
  client_greenline: COMPANY_E,
  client_urban: COMPANY_E,
};

export function companyOfClient(clientId: string): string {
  const companyId = CLIENT_COMPANY[clientId];
  if (!companyId) throw new Error(`Seed: ${clientId} is not a demo client.`);
  return companyId;
}

/** A record's company: its project's when it has one, otherwise its client's, otherwise Aurelia's. */
export function companyFor(record: { project?: string | null; client?: string | null }): string {
  if (record.project) return companyOfProject(record.project);
  if (record.client) return companyOfClient(record.client);
  return COMPANY_A;
}
