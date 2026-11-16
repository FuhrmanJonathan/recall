"use client";

import { useState, type ReactNode } from "react";

export function ChipInput({ id, label, value, onChange, suggestions, disabled, renderChip, placeholder }: {
  id: string; label: string; value: string[]; onChange: (next: string[]) => void;
  suggestions: string[]; disabled?: boolean; placeholder?: string;
  renderChip: (name: string, remove: () => void) => ReactNode;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  function add(raw: string) {
    const name = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!name) return;
    if (value.includes(name)) { setText(""); return; }
    if (name.length > 40) { setErr("Up to 40 characters."); return; }
    if (value.length >= 10) { setErr("Up to 10 allowed."); return; }
    onChange([...value, name]); setText(""); setErr("");
  }

  return <div>
    <label htmlFor={id} className="text-sm font-semibold">{label}</label>
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
      {value.map((n) => <span key={n}>{renderChip(n, () => onChange(value.filter((v) => v !== n)))}</span>)}
      <input id={id} list={`${id}-list`} value={text} disabled={disabled} autoComplete="off"
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => { setText(e.target.value); setErr(""); }}
        onBlur={() => add(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); }
          else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none" />
      <datalist id={`${id}-list`}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
    {err && <p role="alert" className="mt-1 text-sm text-red-700">{err}</p>}
  </div>;
}