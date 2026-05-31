import { useState } from "react";
import { useApi } from "@internal/api-client/react";
import type { TeamRequestDto } from "@internal/shared-types";
import { RequestEditForm, toEditError, type RequestEdit } from "./RequestEditForm";

interface RespondToProposalDialogProps {
  request: TeamRequestDto | null;
  onClose: () => void;
  onResponded: (next: TeamRequestDto) => void;
}

// Requester-side dialog for countering an admin's team-request proposal.
export function RespondToProposalDialog({
  request,
  onClose,
  onResponded,
}: RespondToProposalDialogProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toEditError> | null>(null);

  if (!request) return null;

  async function submit(edit: RequestEdit) {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.teamRequests.respond(request.id, {
        action: "counter",
        ...edit,
      });
      onResponded(next);
      onClose();
    } catch (err) {
      setError(toEditError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-app-border bg-app-surface p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-app-text">Counter-propose</h2>
        <p className="mt-1 text-xs text-app-text-muted">
          Edit the admin's proposal and send it back. The admin will see your changes and can
          approve, propose more changes, or reject.
        </p>
        <RequestEditForm
          request={request}
          busy={busy}
          nextRound={request.roundCount + 1}
          onSubmit={submit}
          onCancel={onClose}
          submitLabel="Send counter-proposal"
          error={error}
        />
      </div>
    </div>
  );
}
