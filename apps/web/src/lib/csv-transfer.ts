export const CSV_MAX_BYTES = 2 * 1024 * 1024;

export type CsvPreview = {
  filename: string;
  valid_count: number;
  skipped_count: number;
  cards: { row: number; question: string; answer: string; tags: string[] }[];
  issues: string[];
  issues_truncated: boolean;
};

export function csvFileError(file: Pick<File, "name" | "size"> | null): string {
  if (!file || file.size === 0) return "Choose a nonempty CSV file.";
  if (!file.name.toLowerCase().endsWith(".csv")) return "Choose a file ending in .csv.";
  if (file.size > CSV_MAX_BYTES) return "CSV file is too large (max 2 MB).";
  return "";
}

export function csvActionLabel(preview: CsvPreview | null, busy: boolean): string {
  if (busy) return preview ? "Importing cards…" : "Checking CSV…";
  return preview ? `Import ${preview.valid_count} cards →` : "Preview CSV →";
}
