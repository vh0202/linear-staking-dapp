import { DashboardSkeleton, PageFrame } from "./Frame";

/** Static page frame without any wallet code: server-rendered and shown while the app loads. */
export function AppShell() {
  return (
    <PageFrame>
      <DashboardSkeleton label="Loading the staking app..." />
    </PageFrame>
  );
}
