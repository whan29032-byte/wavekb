import { resolvedStickerMime } from "./chat-stickers";

// During dragover browsers protect file contents; only types/items are readable.
export function hasFileTransfer(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && (Array.from(transfer.types ?? []).includes("Files")
    || Array.from(transfer.items ?? []).some((item) => item.kind === "file")
    || transfer.files?.length));
}

export function imageFromTransfer(transfer: DataTransfer | null): File | null {
  if (!transfer) return null;
  const files = [...Array.from(transfer.files ?? []), ...Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => Boolean(file))];
  return files.find((file) => resolvedStickerMime(file)) ?? null;
}
