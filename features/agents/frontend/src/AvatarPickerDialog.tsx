// Modal gallery for picking a platform-shipped preset agent avatar.
import { useEffect } from "react";
import { AgentAvatar } from "@internal/shared-ui";
import type { AvatarPreset } from "./avatarPresets";

interface AvatarPickerDialogProps {
  open: boolean;
  value: string;
  presets: AvatarPreset[];
  onSelect: (src: string) => void;
  onClose: () => void;
}

export function AvatarPickerDialog({
  open,
  value,
  presets,
  onSelect,
  onClose,
}: AvatarPickerDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-app-border bg-app-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-app-text">Choose an avatar</h3>
        {presets.length === 0 && (
          <p className="text-xs text-app-text-muted">No preset avatars are available.</p>
        )}
        <div className="grid grid-cols-5 gap-3">
          {presets.map((preset) => {
            const selected = preset.src === value;
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                onClick={() => onSelect(preset.src)}
                className={`flex items-center justify-center rounded-lg border p-2 hover:bg-app-surface-hover ${
                  selected ? "border-app-primary ring-2 ring-app-primary" : "border-app-border"
                }`}
              >
                <AgentAvatar name={preset.label} avatarUrl={preset.src} size={56} />
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-app-text-muted hover:bg-app-surface-hover"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
