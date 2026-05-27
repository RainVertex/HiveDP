import type { ReactNode } from "react";
import { PageLayout } from "@internal/shared-ui";
import { ProfileView } from "../profile";
import { ThemeSwitcher } from "../theme";

export function SettingsPage() {
  return (
    <PageLayout title="Settings" description="Your profile and appearance preferences.">
      <div className="grid gap-6 max-w-4xl lg:grid-cols-2">
        <Card title="Profile" description="Sourced from your GitHub account.">
          <ProfileView />
        </Card>
        <Card
          title="Appearance"
          description="Pick a theme -- your choice is saved in this browser."
        >
          <ThemeSwitcher variant="grid" />
        </Card>
      </div>
    </PageLayout>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-app-border bg-app-surface p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-app-text">{title}</h2>
        {description && <p className="mt-1 text-sm text-app-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
