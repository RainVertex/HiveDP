// Read-only chips for the maintainers and members chosen on a team request.
import type { TeamRequestDto } from "@internal/shared-types";

interface ProposedMembersListProps {
  request: Pick<TeamRequestDto, "proposedMaintainers" | "proposedMembers">;
}

export function ProposedMembersList({ request }: ProposedMembersListProps) {
  const hasMaintainers = request.proposedMaintainers.length > 0;
  const hasMembers = request.proposedMembers.length > 0;
  if (!hasMaintainers && !hasMembers) return null;
  return (
    <div className="mt-1 space-y-1 text-xs">
      {hasMaintainers && <Row label="Maintainers" users={request.proposedMaintainers} />}
      {hasMembers && <Row label="Members" users={request.proposedMembers} />}
    </div>
  );
}

function Row({
  label,
  users,
}: {
  label: string;
  users: Array<{ userId: string; displayName: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-app-text-muted">{label}:</span>
      {users.map((u) => (
        <span
          key={u.userId}
          className="inline-flex items-center rounded-full border border-app-border bg-app-surface-hover px-2 py-0.5 text-app-text"
        >
          {u.displayName}
        </span>
      ))}
    </div>
  );
}
