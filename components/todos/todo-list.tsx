import { CheckCircle2, Circle, CircleDashed, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OcTodo, SessionTodos } from "@/types/oc";

function StatusIcon({ todo }: { todo: OcTodo }) {
  const className = "size-4 shrink-0";
  if (todo.status === "completed") return <CheckCircle2 aria-label="Completed" className={`${className} text-success`} />;
  if (todo.status === "in_progress") return <CircleDashed aria-label="In progress" className={`${className} text-warning`} />;
  if (todo.status === "pending") return <Circle aria-label="Pending" className={`${className} text-muted-foreground`} />;
  return <CircleHelp aria-label="Unknown status" className={`${className} text-muted-foreground`} />;
}

export function TodoList({ sessions }: { sessions: SessionTodos[] }) {
  return <div className="space-y-4">{sessions.map((session) => <section key={session.sessionId} className="rounded-lg border border-border bg-card"><header className="border-b border-border px-4 py-3"><h2 className="font-mono text-sm font-medium">{session.sessionId}</h2><p className="mt-1 text-xs text-muted-foreground">{session.todos.length} todos</p></header><ol className="divide-y divide-border">{session.todos.map((todo) => <li key={`${todo.position}-${todo.content}`} className="flex items-start gap-3 px-4 py-3"><StatusIcon todo={todo} /><div className="min-w-0 flex-1"><p className={todo.status === "completed" ? "text-sm text-muted-foreground line-through" : "text-sm"}>{todo.content}</p><div className="mt-1 flex gap-2"><Badge variant="outline">{todo.status}</Badge>{todo.priority && <Badge variant="secondary">{todo.priority}</Badge>}</div></div><span className="font-mono text-xs text-muted-foreground">#{todo.position + 1}</span></li>)}</ol></section>)}</div>;
}
