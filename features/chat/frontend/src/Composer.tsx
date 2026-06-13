// Message input box: auto-growing textarea with image attachments and a Send button that toggles to Stop while streaming.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@internal/i18n";
import {
  fileToChatImageDataUrl,
  MAX_CHAT_ATTACHMENTS,
  type ChatImageAttachment,
} from "./chatImage";
import { ImageIcon } from "./icons";

interface PendingImage extends ChatImageAttachment {
  id: string;
}

interface Props {
  onSend: (text: string, attachments: ChatImageAttachment[]) => void;
  onStop?: () => void;
  streaming: boolean;
  stopDisabled?: boolean;
  placeholder?: string;
  visionEnabled?: boolean;
}

export function Composer({
  onSend,
  onStop,
  streaming,
  stopDisabled,
  placeholder,
  visionEnabled = false,
}: Props) {
  const { t } = useTranslation("chat");
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const atLimit = pending.length >= MAX_CHAT_ATTACHMENTS;
  const canAttach = visionEnabled && !streaming && !atLimit;
  const attachTitle = !visionEnabled
    ? t("composer.attachDisabledTooltip")
    : atLimit
      ? t("composer.attachmentLimit")
      : t("composer.attachImage");

  async function addFiles(files: File[]) {
    if (!visionEnabled || streaming) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const att = await fileToChatImageDataUrl(file);
        idRef.current += 1;
        const id = `att-${idRef.current}`;
        setPending((prev) =>
          prev.length >= MAX_CHAT_ATTACHMENTS ? prev : [...prev, { id, ...att }],
        );
      } catch {
        // Unreadable files are skipped, the chip simply never appears.
      }
    }
  }

  function submit() {
    const trimmed = text.trim();
    if ((!trimmed && pending.length === 0) || streaming) return;
    onSend(
      trimmed,
      pending.map((p) => ({ dataUrl: p.dataUrl, mimeType: p.mimeType })),
    );
    setText("");
    setPending([]);
  }

  return (
    <div
      className={`border-t border-app-border bg-app-surface p-2 sm:p-3 ${
        dragOver ? "ring-2 ring-inset ring-app-primary" : ""
      }`}
      onDragOver={(e) => {
        if (!visionEnabled || streaming) return;
        if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!visionEnabled || streaming) return;
        e.preventDefault();
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((p, i) => (
            <div key={p.id} className="relative">
              <img
                src={p.dataUrl}
                alt={t("message.imageAlt", { index: i + 1 })}
                className="h-12 w-12 rounded-app-md border border-app-border object-cover"
              />
              <button
                type="button"
                onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                title={t("composer.removeAttachment")}
                aria-label={t("composer.removeAttachment")}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-app-border bg-app-surface text-[10px] leading-none text-app-text-muted hover:text-app-text"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!canAttach}
          title={attachTitle}
          aria-label={t("composer.attachImage")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-app-md border border-app-border bg-app-surface text-app-text-muted hover:bg-app-surface-hover hover:text-app-text disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
        >
          <ImageIcon />
        </button>
        {/* No capture attribute on purpose, mobile must open the gallery picker, never the camera. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addFiles(files);
          }}
        />
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            if (!visionEnabled || streaming) return;
            const files = Array.from(e.clipboardData.items)
              .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
              .map((i) => i.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.length > 0) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          placeholder={placeholder ?? t("composer.placeholder")}
          rows={1}
          disabled={streaming}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          // text-base on mobile prevents iOS Safari's zoom-on-focus; text-sm at sm+ keeps desktop unchanged.
          className="flex-1 resize-none rounded-app-md border border-app-border bg-app-bg-sunken px-3 py-2 text-base text-app-text placeholder:text-app-text-subtle focus:outline-none focus:ring-2 focus:ring-app-primary disabled:opacity-60 sm:text-sm [&::-webkit-scrollbar]:hidden"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopDisabled}
            title={stopDisabled ? t("composer.stopDisabledTooltip") : t("composer.stop")}
            className="h-10 shrink-0 rounded-app-md border border-app-border bg-app-surface px-3 text-sm text-app-text hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:px-4"
          >
            {t("composer.stop")}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() && pending.length === 0}
            className="h-10 shrink-0 rounded-app-md bg-app-primary px-3 text-sm font-medium text-app-primary-foreground hover:bg-app-primary-hover disabled:opacity-50 sm:h-9 sm:px-4"
          >
            {t("composer.send")}
          </button>
        )}
      </div>
    </div>
  );
}
