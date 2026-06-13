import { useEffect, useState } from "react";
import { useApi } from "@internal/api-client/react";

// Composer-side vision flag, the full ready/reason gate stays in the shell's ChatRoute.
export function useChatConfig(): { visionReady: boolean } {
  const api = useApi();
  const [visionReady, setVisionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.chat
      .getConfig()
      .then((c) => {
        if (!cancelled) setVisionReady(c.visionReady);
      })
      .catch(() => {
        if (!cancelled) setVisionReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return { visionReady };
}
