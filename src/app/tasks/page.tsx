import { DesktopAppShell } from "@/components/desktop-app-shell";
import { TasksWorkspace } from "@/components/tasks-workspace";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <DesktopAppShell>
      <TasksWorkspace />
    </DesktopAppShell>
  );
}
