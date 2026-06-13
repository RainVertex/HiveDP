// Client-side chat attachment processing: downscale a picked image to a data URL the vision model can read.

export const MAX_CHAT_ATTACHMENTS = 4;

// 1536px keeps screenshot text legible for vision models without bloating the message payload.
const MAX_DIM = 1536;

export interface ChatImageAttachment {
  dataUrl: string;
  mimeType: string;
}

// Re-encoding through canvas normalizes the format to JPEG, which every vision provider can decode.
export async function fileToChatImageDataUrl(file: File): Promise<ChatImageAttachment> {
  if (!file.type.startsWith("image/")) throw new Error("Not an image file");

  const source = await readAsDataUrl(file);
  const img = await loadImage(source);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("Image decode failed");

  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  // JPEG has no alpha channel, without the white fill transparent areas turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // JPEG on purpose, Ollama's vision pipeline cannot decode WebP data URLs.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { dataUrl, mimeType: "image/jpeg" };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = src;
  });
}
