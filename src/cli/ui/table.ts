import Table from "cli-table3";
import chalk from "chalk";
import stripAnsi from "strip-ansi";

const MAX_TABLE_WIDTH = 120;
const MAX_REGULAR_COLUMN_WIDTH = 32;
const CELL_PADDING = 2;

function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 20 ? process.stdout.columns : 100;
}

function visibleLength(cell: string): number {
  return Math.max(...stripAnsi(cell).split("\n").map((line) => line.length), 0);
}

/**
 * A plain-bordered table with headers colored via chalk (so color auto-disables for
 * non-TTY/piped output, same as the rest of the CLI) rather than cli-table3's own built-in
 * `style.head` coloring. Whichever column actually has the longest content (usually a file
 * path) gets the terminal's remaining width and wraps; every other column is sized to its own
 * natural content, capped at MAX_REGULAR_COLUMN_WIDTH - so a short "Source" column doesn't end
 * up stretched just because it happens to be last, and a long path doesn't blow out the table.
 */
export function renderTable(headers: string[], rows: string[][]): string {
  const available = Math.min(terminalWidth(), MAX_TABLE_WIDTH) - 2;

  const naturalWidths = headers.map(
    (header, i) => Math.max(header.length, ...rows.map((r) => visibleLength(r[i] ?? ""))) + CELL_PADDING,
  );
  const widestColumn = naturalWidths.indexOf(Math.max(...naturalWidths));

  const colWidths = naturalWidths.map((w, i) => (i === widestColumn ? 0 : Math.min(w, MAX_REGULAR_COLUMN_WIDTH)));
  const usedByOthers = colWidths.reduce((sum, w) => sum + w, 0);
  colWidths[widestColumn] = Math.max(available - usedByOthers, MAX_REGULAR_COLUMN_WIDTH);

  const table = new Table({
    head: headers.map((h) => chalk.gray.bold(h)),
    style: { head: [], border: [] },
    colWidths,
    wordWrap: true,
  });
  for (const row of rows) table.push(row);
  return table.toString();
}
