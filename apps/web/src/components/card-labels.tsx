"use client";

import type { ReactNode } from "react";

export type LabelInfo = { name: string; color: string };

export const PALETTE: Record<string, { bg: string; fg: string }> = {
  gray:   { bg: "#f3f4f6", fg: "#374151" },
  red:    { bg: "#fee2e2", fg: "#991b1b" },
  orange: { bg: "#ffedd5", fg: "#9a3412" },
  yellow: { bg: "#fef9c3", fg: "#854d0e" },
  green:  { bg: "#dcfce7", fg: "#166534" },
  teal:   { bg: "#ccfbf1", fg: "#115e59" },
  blue:   { bg: "#dbeafe", fg: "#1e40af" },
  purple: { bg: "#f3e8ff", fg: "#6b21a8" },
  pink:   { bg: "#fce7f3", fg: "#9d174d" },
};
export const COLOR_KEYS = Object.keys(PALETTE);

export function colorStyle(c?: string) {
  const p = PALETTE[c ?? ""] ?? PALETTE.blue;
  return { backgroundColor: p.bg, color: p.fg };
}

// Only a fallback for names the server hasn't colored yet. Stored colors always win.
export function defaultColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}

export function LabelChip({ name, color, children }: { name: string; color: string; children?: ReactNode }) {
  return <span style={colorStyle(color)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm">{name}{children}</span>;
}

export function ColorPicker({ title, current, onPick }: { title: string; current: string; onPick: (c: string) => void }) {
  return <div role="group" aria-label={`Color for ${title}`} className="flex flex-wrap items-center gap-2">
    <span className="text-sm text-gray-600">Color for “{title}”:</span>
    {COLOR_KEYS.map((k) => <button key={k} type="button" aria-label={k} title={k} onClick={() => onPick(k)}
      className={`h-6 w-6 rounded-full border-2 ${current === k ? "border-gray-900" : "border-white ring-1 ring-gray-300"}`}
      style={{ backgroundColor: PALETTE[k].bg }} />)}
  </div>;
}