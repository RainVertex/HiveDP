// Admin dialog to edit a team request and send it back to the requester for confirmation.
import { useState } from "react";
import { useApi } from "@internal/api-client/react";
import type { TeamRequestDto } from "@internal/shared-types";
import { RequestEditForm, toEditError } from "./RequestEditForm";

interface ProposeChangesDialogProps {
  request: TeamRequestDto | null;
  onClose: () => void;
  onProposed: (next: TeamRequestDto) => void;
}

export function ProposeChangesDialog({ request, onClose, onProposed }: ProposeChangesDialogProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toEditError> | null>(null);

  if (!request) return null;

  async function submit(edit: Parameters<typeof api.teamRequests.propose>[1]) {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.teamRequests.propose(request.id, edit);
      onProposed(next);
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
        <h2 className="text-lg font-semibold text-app-text">Propose changes</h2>
        <p className="mt-1 text-xs text-app-text-muted">
          Edit any field and send back to the requester for confirmation. They can confirm,
          counter-propose, or cancel.
        </p>
        <RequestEditForm
          request={request}
          busy={busy}
          nextRound={request.roundCount + 1}
          onSubmit={submit}
          onCancel={onClose}
          submitLabel="Send proposal"
          error={error}
        />
      </div>
    </div>
  );
}
