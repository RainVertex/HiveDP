import { NavLink } from "react-router-dom";
import type { ChatConversationSummaryDto } from "@internal/shared-types";
import { TrashIcon, PlusIcon } from "./icons";

interface Props {
  conversations: ChatConversationSummaryDto[];
  activeId: string | null;
  onNewChat: () => void;
  onDelete: (id: string) => void;
}

export function ConversationList({ conversations, activeId, onNewChat, onDelete }: Props) {
  return (
    <aside className="flex h-full w-full flex-col bg-app-surface">
      <div className="flex items-center justify-between p-3">
        <h2 className="text-sm font-semibold text-app-text">Conversations</h2>
        <button
          type="button"
          onClick={onNewChat}
          title="New chat"
          className="flex h-8 w-8 items-center justify-center rounded-app-md bg-app-primary text-app-primary-foreground hover:bg-app-primary-hover"
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
              className={({ isActive }) =>
                `flex w-full items-start justify-between gap-2 rounded-app-md px-2 py-2 text-sm transition-colors ${
                  isActive || c.id === activeId
                    ? "bg-app-primary-soft text-app-primary-soft-foreground"
                    : "text-app-text hover:bg-app-surface-hover"
                }`
              }
            >
              <span className="truncate">{c.title}</span>
            </NavLink>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onDelete(c.id);
              }}
              title="Delete conversation"
              className="absolute right-2 top-2 hidden rounded p-1 text-app-text-muted hover:bg-app-surface-hover hover:text-app-danger group-hover:block"
            >
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
