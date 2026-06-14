import { useEffect, useState } from "react";
import { ChatPage } from "@feature/chat-frontend";
import { PageLayout } from "@internal/shared-ui";
import type { ChatConfigDto } from "@internal/shared-types";
import { useApi } from "@internal/api-client/react";
import { useCurrentUser } from "../../auth";

// Apps-web /chat wrapper: gates the assistant until its agent model is enabled and its provider has a key.
export function ChatRoute() {
  const me = useCurrentUser();
  const api = useApi();
  const [config, setConfig] = useState<ChatConfigDto | null>(null);

  useEffect(() => {
    // On transient error fall back to ready; the send-time 409 is the backstop.
    api.chat
      .getConfig()
      .then(setConfig)
      .catch(() => setConfig({ ready: true, reason: null, visionReady: false }));
  }, [api]);

  if (config && !config.ready) {
    return (
      <PageLayout title="Assistant">
        <div className="mx-auto max-w-md rounded-lg border border-app-border bg-app-surface p-6 text-center">
          <p className="mb-2 text-sm font-medium text-app-text">The assistant is not set up yet.</p>
          {me.role === "admin" ? (
            <p className="text-sm text-app-text-muted">
              Go to Agents -&gt; Platform Assistant and pick an enabled model, then make sure its
              provider has an API key in Admin -&gt; AI / Models.
            </p>
          ) : (
            <p className="text-sm text-app-text-muted">
              An administrator needs to finish setting up the Platform Assistant before you can
              start chatting. Please contact your admin.
            </p>
          )}
        </div>
      </PageLayout>
    );
  }

  return <ChatPage userName={me.displayName} userAvatarUrl={me.avatarUrl} />;
}
