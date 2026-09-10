import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheckBig } from "lucide-react";

import { ModuleShell, resolveTab } from "@/components/modules/module-shell";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
import { demoTasks, type DemoTask } from "@/lib/mock/demo-data";

const MODULE_KEY = "tasks" as const;

export const metadata: Metadata = {
  title: modules[MODULE_KEY].label,
};

const priorityTone = {
  high: "danger",
  medium: "warning",
  low: "default",
} as const;

const statusTone = {
  open: "default",
  "in-progress": "info",
  completed: "success",
} as const;

const statusLabel = {
  open: "Open",
  "in-progress": "In progress",
  completed: "Completed",
} as const;

function TaskTable({ tasks }: { tasks: DemoTask[] }) {
  return (
    <div className="nesto-card overflow-hidden">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Task</TableHeaderCell>
            <TableHeaderCell className="hidden md:table-cell">Project</TableHeaderCell>
            <TableHeaderCell className="hidden lg:table-cell">Assignee</TableHeaderCell>
            <TableHeaderCell>Priority</TableHeaderCell>
            <TableHeaderCell className="hidden sm:table-cell">Status</TableHeaderCell>
            <TableHeaderCell className="hidden xl:table-cell">Due</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="font-medium">{task.title}</TableCell>
              <TableCell className="hidden md:table-cell">
                <Link
                  href={`/projects/${task.projectId}`}
                  className="text-fg-muted transition-colors hover:text-accent"
                >
                  {task.project}
                </Link>
              </TableCell>
              <TableCell className="hidden text-fg-muted lg:table-cell">{task.assignee}</TableCell>
              <TableCell>
                <Badge tone={priorityTone[task.priority]}>
                  {task.priority[0].toUpperCase() + task.priority.slice(1)}
                </Badge>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge tone={statusTone[task.status]}>{statusLabel[task.status]}</Badge>
              </TableCell>
              <TableCell className="hidden text-fg-muted xl:table-cell">{task.due}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission(modules[MODULE_KEY].viewPermission);
  const { tab } = await searchParams;
  const activeTab = resolveTab(MODULE_KEY, tab);

  const mine = demoTasks.filter(
    (task) => task.assigneeEmail === user.email && task.status !== "completed",
  );
  const all = demoTasks.filter((task) => task.status !== "completed");
  const completed = demoTasks.filter((task) => task.status === "completed");

  return (
    <ModuleShell
      moduleKey={MODULE_KEY}
      activeTab={activeTab}
      filters={
        <FilterBar
          searchPlaceholder="Search tasks…"
          disabled
          filters={[
            { label: "Status", options: ["Open", "In progress", "Completed"] },
            { label: "Priority", options: ["High", "Medium", "Low"] },
          ]}
        />
      }
    >
      {activeTab === "mine" ? (
        mine.length > 0 ? (
          <TaskTable tasks={mine} />
        ) : (
          <EmptyState
            icon={<CircleCheckBig />}
            title="No tasks assigned to you."
            description="Tasks assigned to you will appear here."
          />
        )
      ) : null}

      {activeTab === "all" ? <TaskTable tasks={all} /> : null}

      {activeTab === "completed" ? (
        completed.length > 0 ? (
          <TaskTable tasks={completed} />
        ) : (
          <EmptyState
            icon={<CircleCheckBig />}
            title="Nothing completed yet."
            description="Completed tasks will appear here."
          />
        )
      ) : null}
    </ModuleShell>
  );
}
