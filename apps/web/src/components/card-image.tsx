"use client";

import { useRef } from "react";
import { btnSecondary } from "@/components/ui";

export type CardImage = { id: number; side: "question" | "answer" };

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

export function validateImage(file: File): string | null {
  if (!TYPES.includes(file.type)) return "Use a PNG, JPG, or WEBP image.";
  if (file.size > MAX_IMAGE_BYTES) return "Image must be under 5 MB.";
  return null;
}

// Use in a textarea's onPaste. Only intercepts the paste if it contains an image,
// so normal text pasting still works.
export function pastedImage(e: React.ClipboardEvent): File | null {
  for (const item of Array.from(e.clipboardData.items)) {
    if (item.kind === "file" && TYPES.includes(item.type)) return item.getAsFile();
  }
  return null;
}

export async function uploadCardImage(cardId: number, side: CardImage["side"], file: File): Promise<CardImage> {
  const body = new FormData();
  body.append("file", file);
  body.append("side", side);
  const res = await fetch(`/api/cards/${cardId}/images`, { method: "POST", body });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Could not upload image.");
  return result;
}

export async function deleteCardImage(id: number) {
  const res = await fetch(`/api/images/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Could not remove image.");
}

export function ImageAttach({ side, images, disabled, onAdd, onRemove }: {
  side: CardImage["side"];
  images: CardImage[];
  disabled?: boolean;
  onAdd: (file: File) => void;
  onRemove: (id: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-2">
      {images.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-3">
          {images.map((img) => (
            <li key={img.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/images/${img.id}`} alt={`${side} image`} className="h-24 w-24 rounded-lg border border-gray-200 object-cover" />
              <button type="button" disabled={disabled} onClick={() => onRemove(img.id)} aria-label={`Remove ${side} image`}
                className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-gray-900 text-xs text-white">×</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} className={btnSecondary}>
        Add image
      </button>
      <span className="ml-3 text-sm text-gray-600">or paste one into the {side} box</span>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAdd(f); e.target.value = ""; }} />
    </div>
  );
}