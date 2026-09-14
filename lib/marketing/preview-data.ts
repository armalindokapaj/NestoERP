/**
 * Records for the public site's product preview only.
 *
 * The application itself reads live data from PostgreSQL — nothing under
 * app/(nesto) imports this. These exist so the marketing preview can show a
 * populated interface without a session, a database or a screenshot that goes
 * stale.
 */
export type DemoStatus = "planning" | "in-progress" | "handover" | "archived";

export type DemoProject = {
  id: string;
  name: string;
  code: string;
  client: string;
  status: DemoStatus;
  progress: number;
  manager: string;
  startDate: string;
  dueDate: string;
  value: string;
  location: string;
  /** Emails of the members treated as assigned, for the "My Projects" tab. */
  assignedTo: string[];
};

export const demoProjects: DemoProject[] = [
  {
    id: "riverside-residences-p2",
    name: "Riverside Residences — Phase 2",
    code: "RIV-P2",
    client: "Meridian Group",
    status: "in-progress",
    progress: 72,
    manager: "Liam Novak",
    startDate: "2026-01-12",
    dueDate: "2026-11-14",
    value: "€1.80M",
    location: "Lisboa, Portugal",
    assignedTo: ["pm@nesto.test", "architect@nesto.test", "engineer@nesto.test", "qaqc@nesto.test"],
  },
  {
    id: "northgate-logistics-hub",
    name: "Northgate Logistics Hub",
    code: "NGH",
    client: "Portside Council",
    status: "in-progress",
    progress: 48,
    manager: "Liam Novak",
    startDate: "2026-03-02",
    dueDate: "2026-12-03",
    value: "€2.40M",
    location: "Porto, Portugal",
    assignedTo: ["pm@nesto.test", "engineer@nesto.test", "hse@nesto.test", "procurement@nesto.test"],
  },
  {
    id: "civic-library-refurbishment",
    name: "Civic Library Refurbishment",
    code: "CLR",
    client: "Ashford Borough",
    status: "handover",
    progress: 91,
    manager: "Liam Novak",
    startDate: "2025-09-08",
    dueDate: "2026-10-21",
    value: "€640K",
    location: "Coimbra, Portugal",
    assignedTo: ["pm@nesto.test", "architect@nesto.test", "qaqc@nesto.test"],
  },
  {
    id: "harbour-view-offices",
    name: "Harbour View Offices",
    code: "HVO",
    client: "Lakeside Homes",
    status: "planning",
    progress: 26,
    manager: "Liam Novak",
    startDate: "2026-06-15",
    dueDate: "2027-01-28",
    value: "€3.10M",
    location: "Faro, Portugal",
    assignedTo: ["pm@nesto.test", "architect@nesto.test", "hse@nesto.test"],
  },
  {
    id: "old-mill-conversion",
    name: "Old Mill Conversion",
    code: "OMC",
    client: "Meridian Group",
    status: "archived",
    progress: 100,
    manager: "Liam Novak",
    startDate: "2024-04-01",
    dueDate: "2025-08-30",
    value: "€1.20M",
    location: "Braga, Portugal",
    assignedTo: ["pm@nesto.test"],
  },
];

export type DemoTask = {
  id: string;
  title: string;
  project: string;
  projectId: string;
  assignee: string;
  assigneeEmail: string;
  due: string;
  priority: "high" | "medium" | "low";
  status: "open" | "in-progress" | "completed";
};

export const demoTasks: DemoTask[] = [
  { id: "t-1", title: "Approve revised foundation drawings", project: "Riverside Residences — Phase 2", projectId: "riverside-residences-p2", assignee: "Liam Novak", assigneeEmail: "pm@nesto.test", due: "Tomorrow", priority: "high", status: "open" },
  { id: "t-2", title: "Confirm subcontractor schedule", project: "Northgate Logistics Hub", projectId: "northgate-logistics-hub", assignee: "Liam Novak", assigneeEmail: "pm@nesto.test", due: "Thursday", priority: "medium", status: "in-progress" },
  { id: "t-3", title: "Issue Level 2 GA plan Rev D", project: "Riverside Residences — Phase 2", projectId: "riverside-residences-p2", assignee: "Marta Lehmann", assigneeEmail: "architect@nesto.test", due: "Friday", priority: "high", status: "in-progress" },
  { id: "t-4", title: "Structural calculation review", project: "Northgate Logistics Hub", projectId: "northgate-logistics-hub", assignee: "Omar Haddad", assigneeEmail: "engineer@nesto.test", due: "Next Monday", priority: "medium", status: "open" },
  { id: "t-5", title: "Close NCR-022", project: "Northgate Logistics Hub", projectId: "northgate-logistics-hub", assignee: "Tomas Rivera", assigneeEmail: "qaqc@nesto.test", due: "Wednesday", priority: "high", status: "open" },
  { id: "t-6", title: "Update project risk register", project: "Harbour View Offices", projectId: "harbour-view-offices", assignee: "Liam Novak", assigneeEmail: "pm@nesto.test", due: "Next Monday", priority: "low", status: "open" },
  { id: "t-7", title: "Site safety walkaround", project: "Harbour View Offices", projectId: "harbour-view-offices", assignee: "Hannah Berg", assigneeEmail: "hse@nesto.test", due: "Today", priority: "high", status: "in-progress" },
  { id: "t-8", title: "Handover snag list sign-off", project: "Civic Library Refurbishment", projectId: "civic-library-refurbishment", assignee: "Tomas Rivera", assigneeEmail: "qaqc@nesto.test", due: "Last Friday", priority: "medium", status: "completed" },
  { id: "t-9", title: "Submit planning pack", project: "Harbour View Offices", projectId: "harbour-view-offices", assignee: "Marta Lehmann", assigneeEmail: "architect@nesto.test", due: "Last Tuesday", priority: "high", status: "completed" },
  { id: "t-10", title: "Order site cabins", project: "Harbour View Offices", projectId: "harbour-view-offices", assignee: "Jonas Weber", assigneeEmail: "procurement@nesto.test", due: "Last Thursday", priority: "medium", status: "completed" },
];

export type DemoClient = {
  id: string;
  name: string;
  industry: string;
  country: string;
  projects: number;
  status: "active" | "prospect";
  owner: string;
};

export const demoClients: DemoClient[] = [
  { id: "meridian-group", name: "Meridian Group", industry: "Property development", country: "Portugal", projects: 2, status: "active", owner: "Priya Raman" },
  { id: "portside-council", name: "Portside Council", industry: "Public sector", country: "Portugal", projects: 1, status: "active", owner: "Priya Raman" },
  { id: "ashford-borough", name: "Ashford Borough", industry: "Public sector", country: "Portugal", projects: 1, status: "active", owner: "Priya Raman" },
  { id: "lakeside-homes", name: "Lakeside Homes", industry: "Residential", country: "Spain", projects: 1, status: "active", owner: "Priya Raman" },
  { id: "harbour-industrial", name: "Harbour Industrial", industry: "Logistics", country: "Portugal", projects: 0, status: "prospect", owner: "Priya Raman" },
];

export type DemoContact = {
  id: string;
  name: string;
  role: string;
  client: string;
  email: string;
  phone: string;
};

export const demoContacts: DemoContact[] = [
  { id: "c-1", name: "Ines Barbosa", role: "Development Director", client: "Meridian Group", email: "ines.barbosa@meridian.test", phone: "+351 21 111 1111" },
  { id: "c-2", name: "Rui Fonseca", role: "Procurement Lead", client: "Portside Council", email: "rui.fonseca@portside.test", phone: "+351 22 222 2222" },
  { id: "c-3", name: "Helena Duarte", role: "Facilities Manager", client: "Ashford Borough", email: "helena.duarte@ashford.test", phone: "+351 23 333 3333" },
  { id: "c-4", name: "Carlos Mendes", role: "Managing Director", client: "Lakeside Homes", email: "carlos.mendes@lakeside.test", phone: "+34 91 444 4444" },
];

export type DemoDocument = {
  id: string;
  name: string;
  type: string;
  project: string;
  size: string;
  updatedBy: string;
  updatedAt: string;
  shared: boolean;
};

export const demoDocuments: DemoDocument[] = [
  { id: "d-1", name: "RIV-A-201 Rev C.pdf", type: "Drawing", project: "Riverside Residences — Phase 2", size: "4.2 MB", updatedBy: "Marta Lehmann", updatedAt: "2 hours ago", shared: true },
  { id: "d-2", name: "Northgate — Method Statement.docx", type: "Method statement", project: "Northgate Logistics Hub", size: "820 KB", updatedBy: "Omar Haddad", updatedAt: "Yesterday", shared: true },
  { id: "d-3", name: "Civic Library — Snag List.xlsx", type: "Snag list", project: "Civic Library Refurbishment", size: "310 KB", updatedBy: "Tomas Rivera", updatedAt: "2 days ago", shared: false },
  { id: "d-4", name: "HV Site Survey.pdf", type: "Survey", project: "Harbour View Offices", size: "12.6 MB", updatedBy: "Liam Novak", updatedAt: "3 days ago", shared: false },
  { id: "d-5", name: "Steelcore — Supply Agreement.pdf", type: "Contract", project: "Company", size: "1.1 MB", updatedBy: "Elena Costa", updatedAt: "4 days ago", shared: true },
  { id: "d-6", name: "HSE Site Induction Pack.pdf", type: "HSE", project: "Company", size: "2.8 MB", updatedBy: "Hannah Berg", updatedAt: "1 week ago", shared: true },
];

export const statusTones: Record<DemoStatus, "default" | "info" | "warning" | "success"> = {
  planning: "default",
  "in-progress": "info",
  handover: "warning",
  archived: "success",
};

