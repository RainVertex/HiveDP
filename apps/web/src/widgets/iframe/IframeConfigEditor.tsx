// Config editor for the iframe widget: an https-validated embed URL input.
import { useState } from "react";
import type { WidgetConfigEditorProps } from "@internal/shared-ui";

export function IframeConfigEditor({ config, onChange }: WidgetConfigEditorProps) {
  const url = typeof config.url === "string" ? config.url : "";
  const [touched, setTouched] = useState(false);
  const isValid = url === "" || url.startsWith("https://");

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-app-text-muted" htmlFor="iframe-url">
        Embed URL
      </label>
      <input
        id="iframe-url"
        type="url"
        value={url}
        placeholder="https://grafana.example.com/d/abc123"
        onChange={(e) => onChange({ ...config, url: e.target.value })}
        onBlur={() => setTouched(true)}
        className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-primary focus:outline-none"
      />
      {touched && !isValid && (
        <p className="text-xs text-app-danger">URL must start with https://</p>
      )}
      <p className="text-xs text-app-text-muted">
        The page is loaded in a sandboxed iframe. Some sites block embedding via X-Frame-Options or
        CSP — those will appear blank.
      </p>
    </div>
  );
}
