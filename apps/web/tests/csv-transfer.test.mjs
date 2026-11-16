import test from "node:test";
import assert from "node:assert/strict";
import { csvActionLabel, csvFileError } from "../src/lib/csv-transfer.ts";

test("CSV files are checked before upload", () => {
  assert.equal(csvFileError(null), "Choose a nonempty CSV file.");
  assert.equal(csvFileError({ name: "cards.csv", size: 0 }), "Choose a nonempty CSV file.");
  assert.equal(csvFileError({ name: "cards.txt", size: 10 }), "Choose a file ending in .csv.");
  assert.equal(csvFileError({ name: "cards.CSV", size: 1024 }), "");
  assert.equal(csvFileError({ name: "cards.csv", size: 2 * 1024 * 1024 + 1 }), "CSV file is too large (max 2 MB).");
});

test("the CSV action clearly separates preview from confirmation", () => {
  const preview = { valid_count: 12 };
  assert.equal(csvActionLabel(null, false), "Preview CSV →");
  assert.equal(csvActionLabel(null, true), "Checking CSV…");
  assert.equal(csvActionLabel(preview, false), "Import 12 cards →");
  assert.equal(csvActionLabel(preview, true), "Importing cards…");
});
