import { NavLink } from "react-router-dom";
import type { ChatConversationSummaryDto } from "@internal/shared-types";
import { TrashIcon, PlusIcon, CheckIcon, CrossIcon } from "./icons";

interface Props {
  conversations: ChatConversationSummaryDto[];
  activeId: string | null;
  pendingDeleteId: string | null;
  onNewChat: () => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  /** Fired after picking a conversation or starting a new one — used by the
   *  mobile drawer to close itself once the user makes a selection. */
  onSelect?: () => void;
}

export function ConversationList({
  conversations,
  activeId,
  pendingDeleteId,
  onNewChat,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onSelect,
}: Props) {
  return (
    <aside className="flex h-full w-full flex-col bg-app-surface">
      <div className="flex items-center justify-between p-3">
        <h2 className="text-sm font-semibold text-app-text">Conversations</h2>
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onSelect?.();
          }}
          title="New chat"
          className="flex h-9 w-9 items-center justify-center rounded-app-md bg-app-primary text-app-primary-foreground hover:bg-app-primary-hover sm:h-8 sm:w-8"
        >
          <PlusIcon />
        </button>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {conversations.length === 0 && (
          <li className="px-2 py-3 text-xs text-app-text-muted">
            No conversations yet. Send a message to start one.
          </li>
        )}
        {conversations.map((c) => (
          <li key={c.id} className="group relative">
            <NavLink
              to={`/chat/${c.id}`}
              onClick={() => onSelect?.()}
              className={({ isActive }) =>
                `flex w-full items-start justify-between gap-2 rounded-app-md py-2.5 pl-2 pr-12 text-sm transition-colors sm:py-2 ${
                  isActive || c.id === activeId
                    ? "bg-app-primary-soft text-app-primary-soft-foreground"
                    : "text-app-text hover:bg-app-surface-hover"
                }`
              }
            >
              <span className="truncate">{c.title}</span>
            </NavLink>
            {pendingDeleteId === c.id ? (
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onConfirmDelete(c.id);
                  }}
                  title="Confirm delete"
                  className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-danger"
                >
                  <CheckIcon />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onCancelDelete();
                  }}
                  title="Cancel delete"
                  className="rounded p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
                >
                  <CrossIcon />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onRequestDelete(c.id);
                }}
                title="Delete conversation"
                className="absolute right-1.5 top-1/2 block -translate-y-1/2 rounded p-1.5 text-app-text-muted hover:bg-app-surface-hover hover:text-app-danger sm:hidden sm:group-hover:block"
              >
                <TrashIcon />
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
