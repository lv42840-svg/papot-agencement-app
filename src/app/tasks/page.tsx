import { DesktopAppShell } from "@/components/desktop-app-shell";
import { TasksDetailWorkspace } from "@/components/tasks-detail-workspace";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <DesktopAppShell>
      <TasksDetailWorkspace />
    </DesktopAppShell>
  );
}
