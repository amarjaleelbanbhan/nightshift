import { describe, it, expect, afterEach } from "vitest";
import stripAnsi from "strip-ansi";
import { renderTable } from "../../src/cli/ui/table.js";

const SEP = String.fromCharCode(92);
const LONG_PATH = [
  "C:",
  "Users",
  "Amar",
  "AppData",
  "Local",
  "Packages",
  "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
  "LocalState",
  "settings.json",
].join(SEP);

const original = process.stdout.columns;

function setColumns(value: number | undefined): void {
  Object.defineProperty(process.stdout, "columns", { value, configurable: true });
}

function widestLine(table: string): number {
  return Math.max(
    ...stripAnsi(table)
      .split("\n")
      .map((l) => l.length),
  );
}

afterEach(() => {
  setColumns(original);
  delete process.env.COLUMNS;
});

describe("renderTable width", () => {
  it("never exceeds the terminal width", () => {
    // Regression: borders were accounted for as a flat 2 regardless of column count, so every
    // 3-column table overflowed by exactly 2 characters at every width, including the 120 cap.
    for (const columns of [24, 40, 60, 80, 100, 120, 200]) {
      setColumns(columns);
      const table = renderTable(["", "Check", "Detail"], [["x", "Windows Terminal", LONG_PATH]]);
      expect(widestLine(table), `columns=${columns}`).toBeLessThanOrEqual(Math.min(columns, 120));
    }
  });

  it("shrinks below the old 57-column floor for narrow terminals", () => {
    setColumns(40);
    const table = renderTable(["", "Check", "Detail"], [["x", "Windows Terminal", LONG_PATH]]);
    expect(widestLine(table)).toBeLessThanOrEqual(40);
  });

  it("falls back to COLUMNS when stdout is not a TTY", () => {
    setColumns(undefined);
    process.env.COLUMNS = "50";
    const table = renderTable(["", "Check", "Detail"], [["x", "Windows Terminal", LONG_PATH]]);
    expect(widestLine(table)).toBeLessThanOrEqual(50);
  });

  it("uses the 100-column default when neither stdout nor COLUMNS gives a usable width", () => {
    setColumns(undefined);
    const table = renderTable(["", "Check", "Detail"], [["x", "Windows Terminal", LONG_PATH]]);
    expect(widestLine(table)).toBeLessThanOrEqual(100);
    expect(widestLine(table)).toBeGreaterThan(60);
  });

  it("gives the remaining width to the column with the longest content", () => {
    // The recorded design decision: a long path must get the slack, not whichever column is
    // last. Keeps a short "Source" column from being stretched.
    setColumns(120);
    const table = renderTable(["ID", "Detail", "Source"], [["a", LONG_PATH, "builtin"]]);
    const [, headerRow] = stripAnsi(table).split("\n");
    expect(headerRow).toBeDefined();
    const cells = (headerRow as string).split("│").filter((c) => c.trim().length > 0);
    const detailCell = cells[1] as string;
    const sourceCell = cells[2] as string;
    expect(detailCell.length).toBeGreaterThan(sourceCell.length * 3);
  });

  it("preserves Windows path separators rather than eating them", () => {
    setColumns(120);
    const table = renderTable(["Detail"], [[LONG_PATH]]);
    expect(stripAnsi(table)).toContain(LONG_PATH);
  });

  it("returns an empty string for zero columns instead of throwing", () => {
    expect(renderTable([], [])).toBe("");
  });

  it("renders headers with no rows without throwing", () => {
    setColumns(100);
    expect(() => renderTable(["ID", "Name"], [])).not.toThrow();
    expect(stripAnsi(renderTable(["ID", "Name"], []))).toContain("ID");
  });

  it("handles rows with missing cells", () => {
    setColumns(100);
    expect(() => renderTable(["A", "B", "C"], [["only-one"]])).not.toThrow();
  });
});
