// GitHub App connect dialog. Unlike Plane (which is a form), GitHub install
// is a redirect flow: the admin clicks Install, the browser navigates to
// GitHub, and the App's OAuth callback comes back to /api/integrations/
// github/callback, which records the Integration and triggers bulk sync.

import { useState } from "react";

export interface GithubConnectDialogProps {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

const INSTALL_URL = "/api/integrations/github/install";

export function GithubConnectDialog({ open, onClose }: GithubConnectDialogProps) {
  const [redirecting, setRedirecting] = useState(false);

  if (!open) return null;

  function handleInstall() {
    setRedirecting(true);
    window.location.href = INSTALL_URL;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-app-border bg-app-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-app-text">Connect GitHub</h3>
        <p className="mt-2 text-xs text-app-text-muted">
          You&rsquo;ll be redirected to GitHub to install the platform&rsquo;s App on an
          organization. After install, GitHub returns you here and the platform starts importing:
        </p>
        <ul className="mt-3 space-y-1 text-xs text-app-text-muted">
          <li>
            <span className="font-medium text-app-text">Repositories</span> &mdash; every repo the
            installation can see, with <code>catalog-info.yaml</code> auto-discovered.
          </li>
          <li>
            <span className="font-medium text-app-text">Teams &amp; members</span> &mdash; org teams
            imported as platform Teams (members matched to existing users by GitHub id; others queue
            with a 7-day TTL until they sign in).
          </li>
        </ul>
        <p className="mt-3 text-xs text-app-text-muted">
          Ongoing changes flow in via webhooks; a weekly cron does a differential reconciliation to
          catch missed deliveries. You can also Resync manually from the integration's Configure
          panel.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInstall}
            disabled={redirecting}
            className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on disabled:opacity-50"
          >
            {redirecting ? "Redirecting…" : "Install on GitHub"}
          </button>
        </div>
      </div>
    </div>
  );
}
