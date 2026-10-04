import { redirect } from "next/navigation";

export default async function PlanningWeekPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const { weekId } = await params;
  const year = /^\d{4}/.exec(weekId)?.[0];
  redirect(year ? `/planning?year=${year}` : "/planning");
}
