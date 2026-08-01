"use client";
import { useMemo, useState } from "react";
import { ListTodo } from "lucide-react";
import { useOc } from "@/hooks/use-oc";
import { schemaVersion } from "@/lib/db/schema-guard";
import { Onboarding } from "@/components/states/onboarding";
import { SchemaMismatch } from "@/components/states/schema-mismatch";
import { WarningsBanner } from "@/components/states/warnings-banner";
import { ErrorState } from "@/components/states/error-state";
import { EmptyState } from "@/components/states/empty-state";
import { TableSkeleton } from "@/components/states/table-skeleton";
import { TodoRollup } from "@/components/todos/todo-rollup";
import { TodoList } from "@/components/todos/todo-list";
import { CompletionChart } from "@/components/todos/completion-chart";

export default function TodosPage() {
  const { data, error, isLoading, mutate } = useOc("/api/todos");
  const [status, setStatus] = useState("all"); const [projectFilter, setProjectFilter] = useState("all");
  const projects = useMemo(() => [...new Set((data?.data.sessions ?? []).map((session) => session.projectId))].sort(), [data]);
  const sessions = useMemo(() => (data?.data.sessions ?? []).map((session) => ({ ...session, todos: session.todos.filter((todo) => status === "all" || todo.status === status) })).filter((session) => session.todos.length > 0 && (projectFilter === "all" || session.projectId === projectFilter)), [data, status, projectFilter]);
  if (isLoading) return <div className="p-6"><TableSkeleton rows={8} columns={3} /></div>;
  if (error?.isDatabaseNotFound) return <Onboarding />;
  if (error?.isSchemaMismatch) return <SchemaMismatch schemaVersion={schemaVersion} message={error.message} />;
  if (error) return <div className="p-6"><ErrorState message={error.message} onRetry={() => void mutate()} /></div>;
  if (!data || data.data.sessions.length === 0) return <div className="p-6"><EmptyState icon={<ListTodo />} title="No todos recorded" description="Todos created by opencode will appear here as read-only status indicators." /></div>;
  return <div className="space-y-6 p-4 sm:p-6"><div><h1 className="text-2xl font-semibold">Todos</h1><p className="mt-1 text-sm text-muted-foreground">Read-only task history from opencode sessions.</p></div><WarningsBanner warnings={data.meta.warnings} /><TodoRollup rollup={data.data.rollup} /><div className="flex flex-wrap gap-3"><label className="text-sm">Status <select className="ml-2 h-9 rounded-md border border-input bg-background px-2" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="unknown">Unknown</option></select></label><label className="text-sm">Project <select className="ml-2 h-9 max-w-64 rounded-md border border-input bg-background px-2" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{projects.map((project) => <option key={project} value={project}>{project}</option>)}</select></label></div>{sessions.length === 0 ? <EmptyState title="No matching todos" description="Change the filters to see other statuses or projects." /> : <><CompletionChart sessions={sessions} /><TodoList sessions={sessions} /></>}</div>;
}
