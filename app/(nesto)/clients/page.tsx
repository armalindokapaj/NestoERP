import type { Metadata } from "next";

import { ModuleShell, resolveTab } from "@/components/modules/module-shell";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { modules } from "@/config/modules";
import { requirePermission } from "@/lib/auth/session";
import { demoClients, demoContacts } from "@/lib/mock/demo-data";

const MODULE_KEY = "clients" as const;

export const metadata: Metadata = {
  title: modules[MODULE_KEY].label,
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission(modules[MODULE_KEY].viewPermission);
  const { tab } = await searchParams;
  const activeTab = resolveTab(MODULE_KEY, tab);

  const active = demoClients.filter((client) => client.status === "active");

  return (
    <ModuleShell
      moduleKey={MODULE_KEY}
      activeTab={activeTab}
      filters={
        <FilterBar
          searchPlaceholder="Search clients…"
          disabled
          filters={[
            { label: "Status", options: ["Active", "Prospect"] },
            { label: "Industry", options: ["Property development", "Public sector", "Retail"] },
          ]}
        />
      }
    >
      {activeTab === "overview" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Active clients", value: String(active.length) },
            { label: "Prospects", value: String(demoClients.length - active.length) },
            { label: "Contacts", value: String(demoContacts.length) },
            {
              label: "Client projects",
              value: String(demoClients.reduce((total, client) => total + client.projects, 0)),
            },
          ].map((stat) => (
            <div key={stat.label} className="nesto-card p-4">
              <p className="text-table text-fg-muted">{stat.label}</p>
              <p className="mt-2 text-page font-semibold tabular-nums text-fg">{stat.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {activeTab === "clients" || activeTab === "overview" ? (
        <div className="nesto-card mt-4 overflow-hidden first:mt-0">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Client</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Industry</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Country</TableHeaderCell>
                <TableHeaderCell>Projects</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {demoClients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell className="hidden text-fg-muted md:table-cell">{client.industry}</TableCell>
                  <TableCell className="hidden text-fg-muted lg:table-cell">{client.country}</TableCell>
                  <TableCell className="tabular-nums text-fg-muted">{client.projects}</TableCell>
                  <TableCell>
                    <Badge tone={client.status === "active" ? "success" : "default"}>
                      {client.status === "active" ? "Active" : "Prospect"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {activeTab === "contacts" ? (
        <div className="nesto-card overflow-hidden">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Role</TableHeaderCell>
                <TableHeaderCell>Client</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Email</TableHeaderCell>
                <TableHeaderCell className="hidden xl:table-cell">Phone</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {demoContacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell className="hidden text-fg-muted md:table-cell">{contact.role}</TableCell>
                  <TableCell className="text-fg-muted">{contact.client}</TableCell>
                  <TableCell className="hidden text-fg-muted lg:table-cell">{contact.email}</TableCell>
                  <TableCell className="hidden text-fg-muted xl:table-cell">{contact.phone}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </ModuleShell>
  );
}
