import { useState } from "react";
import { PageLayout } from "@internal/shared-ui";

const PLANE_URL = "http://localhost:3000";

export function PlaneEmbedPage() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <PageLayout
      title="Plane"
      description="Self-hosted Plane workspace embedded directly. Sign in on the Plane side once; cookies persist for the session."
      actions={
        <>
          <a
            href={PLANE_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            Open in new tab
          </a>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on"
          >
            Reload
          </button>
        </>
      }
    >
      <div className="h-[calc(100vh-180px)] w-full overflow-hidden rounded-lg border border-app-border bg-app-surface">
        <iframe key={reloadKey} src={PLANE_URL} title="Plane" className="h-full w-full border-0" />
      </div>
    </PageLayout>
  );
}
