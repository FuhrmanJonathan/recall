"use client";

import { useState, type ReactNode } from "react";
import { btnSecondary } from "@/components/ui";

export default function YogoReplay({ children }: { children: ReactNode }) {
  const [replay, setReplay] = useState(0);
  return <><button type="button" onClick={() => setReplay((value) => value + 1)} className={`mb-6 ${btnSecondary}`}>Replay</button><div key={replay}>{children}</div></>;
}
