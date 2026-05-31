import { ChatAssistantPanel } from "@feature/chat-frontend";
import { useCurrentUser } from "../../auth";

// Resolves auth identity here because the widget framework calls this with no props.
export function ChatAssistantWidget() {
  const me = useCurrentUser();
  return (
    <ChatAssistantPanel userId={me.id} userName={me.displayName} userAvatarUrl={me.avatarUrl} />
  );
}
