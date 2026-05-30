import { useEffect, useState } from "react";
import { ChatPage } from "@feature/chat-frontend";
import { PageLayout } from "@internal/shared-ui";
import type { ChatConfigDto } from "@internal/shared-types";
import { useApi } from "@internal/api-client/react";
import { useCurrentUser } from "../../auth";

// Apps-web wrapper for the /chat routes. Resolves the current user and gates
// the assistant on readiness: until an admin selects an active chat model the
// user sees a friendly not-configured message instead of the chat surface.
export function ChatRoute() {
  const me = useCurrentUser();
  const api = useApi();
  const [config, setConfig] = useState<ChatConfigDto | null>(null);

  useEffect(() => {
    // On a transient error, fall back to "ready" and let the send-time 409 be
    // the backstop, so a blip doesn't hide a working assistant.
    api.chat
      .getConfig()
      .then(setConfig)
      .catch(() => setConfig({ ready: true, reason: null }));
  }, [api]);

  if (config && !config.ready) {
    return (
      <PageLayout title="Assistant">
        <div className="mx-auto max-w-md rounded-lg border border-app-border bg-app-surface p-6 text-center">
          <p className="mb-2 text-sm font-medium text-app-text">The assistant is not set up yet.</p>
          <p className="text-sm text-app-text-muted">
            An administrator needs to choose a chat model in Admin -&gt; AI / Models before you can
            start chatting. Please contact your admin.
          </p>
        </div>
      </PageLayout>
    );
  }

  return <ChatPage userName={me.displayName} userAvatarUrl={me.avatarUrl} />;
}
