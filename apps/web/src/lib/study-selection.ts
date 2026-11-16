export type StudySelection = { deckIds: string[]; tags: string[]; size: number; shuffle: boolean };
export const defaultSelection: StudySelection = { deckIds: [], tags: [], size: 20, shuffle: false };

export function readSelection(value: unknown): StudySelection {
  if (!value || typeof value !== "object") return { ...defaultSelection };
  const s = value as Partial<StudySelection>;
  return {
    deckIds: Array.isArray(s.deckIds) ? [...new Set(s.deckIds.filter((id): id is string => typeof id === "string" && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))))].slice(0, 50) : [],
    tags: Array.isArray(s.tags) ? [...new Set(s.tags.filter((tag): tag is string => typeof tag === "string" && !!tag.trim() && tag.length <= 40 && !tag.includes(",")))].slice(0, 30) : [],
    size: Number.isInteger(s.size) && s.size! >= 1 && s.size! <= 100 ? s.size! : 20,
    shuffle: s.shuffle === true,
  };
}

export function selectionFromUrl(params: URLSearchParams, saved: StudySelection): StudySelection {
  // A link from a deck is an explicit focus: don't silently carry over saved tags.
  const explicit = ["deck", "tag", "label"].some(key => params.has(key));
  return {
    ...saved,
    deckIds: explicit ? [...new Set(params.getAll("deck"))] : saved.deckIds,
    tags: explicit ? [...new Set([...params.getAll("tag"), ...params.getAll("label")])] : saved.tags,
    size: params.has("size") ? readSelection({ size: Number(params.get("size")) }).size : saved.size,
    shuffle: params.has("shuffle") ? params.get("shuffle") === "1" : saved.shuffle,
  };
}

export function selectionParams(selection: StudySelection): URLSearchParams {
  const params = new URLSearchParams();
  selection.deckIds.forEach(id => params.append("deck", id));
  selection.tags.forEach(tag => params.append("tag", tag));
  if (selection.size !== 20) params.set("size", String(selection.size));
  if (selection.shuffle) params.set("shuffle", "1");
  return params;
}

export function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
