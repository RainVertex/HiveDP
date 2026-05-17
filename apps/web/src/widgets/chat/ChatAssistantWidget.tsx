import { ChatAssistantPanel } from "@feature/chat-frontend";
import { useCurrentUser } from "../../auth";

// Thin wrapper that resolves the auth identity (an apps/web concern) and
// hands it to the feature-package panel. The widget framework calls this
// with no props, so the panel can't read auth context on its own.
export function ChatAssistantWidget() {
  const me = useCurrentUser();
  return (
    <ChatAssistantPanel userId={me.id} userName={me.displayName} userAvatarUrl={me.avatarUrl} />
  );
}
