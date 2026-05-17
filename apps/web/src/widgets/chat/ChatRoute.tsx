import { ChatPage } from "@feature/chat-frontend";
import { useCurrentUser } from "../../auth";

// Apps-web wrapper for the /chat routes. Resolves the current user (an
// apps/web concern) and threads the display name + avatar through to the
// feature-package ChatPage so it can render the right-side message avatars
// without importing from apps/web.
export function ChatRoute() {
  const me = useCurrentUser();
  return <ChatPage userName={me.displayName} userAvatarUrl={me.avatarUrl} />;
}
