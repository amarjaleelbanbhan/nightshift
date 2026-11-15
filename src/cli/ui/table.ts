import Table from "cli-table3";
import chalk from "chalk";
import stripAnsi from "strip-ansi";
import "./color-mode.js";

const MAX_TABLE_WIDTH = 120;
const MAX_REGULAR_COLUMN_WIDTH = 32;
const CELL_PADDING = 2;
/** Below this a column cannot hold padding plus an ellipsis, and cli-table3 misrenders. */
const MIN_COLUMN_WIDTH = 6;
const MIN_USABLE_TERMINAL_WIDTH = 20;
const FALLBACK_TERMINAL_WIDTH = 100;

/**
 * `process.stdout.columns` is undefined whenever stdout is not a TTY (pipes, CI, test
 * harnesses), so `COLUMNS` is consulted as the documented fallback before giving up on the
 * default. Without it the narrow-terminal path is unreachable from a non-TTY process and
 * therefore untestable.
 */
function terminalWidth(): number {
  const fromStdout = process.stdout.columns;
  if (fromStdout && fromStdout >= MIN_USABLE_TERMINAL_WIDTH) return fromStdout;
  const fromEnv = Number(process.env.COLUMNS);
  if (Number.isInteger(fromEnv) && fromEnv >= MIN_USABLE_TERMINAL_WIDTH) return fromEnv;
  return FALLBACK_TERMINAL_WIDTH;
}

function visibleLength(cell: string): number {
  return Math.max(
    ...stripAnsi(cell)
      .split("\n")
      .map((line) => line.length),
    0,
  );
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
  if (headers.length === 0) return "";

  // One border glyph per column plus a closing one. Previously a flat 2 was subtracted, which
  // made every table overflow the terminal by (columns - 1) characters - measured at exactly
  // +2 for the 3-column tables this CLI renders, at every width including the 120 cap.
  const borders = headers.length + 1;
  const available = Math.min(terminalWidth(), MAX_TABLE_WIDTH) - borders;

  const naturalWidths = headers.map(
    (header, i) =>
      Math.max(header.length, ...rows.map((r) => visibleLength(r[i] ?? ""))) + CELL_PADDING,
  );
  const widestColumn = naturalWidths.indexOf(Math.max(...naturalWidths));

  // Regular columns normally keep their natural width, capped at MAX_REGULAR_COLUMN_WIDTH. When
  // even that overflows a narrow terminal they are squeezed to an equal share of what is left
  // after reserving MIN_COLUMN_WIDTH for the content column, instead of holding their natural
  // width and pushing the table past the terminal edge.
  const regularWidth = (w: number, cap: number) => Math.min(w, cap);
  let colWidths = naturalWidths.map((w, i) =>
    i === widestColumn ? 0 : regularWidth(w, MAX_REGULAR_COLUMN_WIDTH),
  );
  let usedByOthers = colWidths.reduce((sum, w) => sum + w, 0);

  if (usedByOthers + MIN_COLUMN_WIDTH > available && headers.length > 1) {
    const share = Math.max(
      Math.floor((available - MIN_COLUMN_WIDTH) / (headers.length - 1)),
      MIN_COLUMN_WIDTH,
    );
    colWidths = naturalWidths.map((w, i) => (i === widestColumn ? 0 : regularWidth(w, share)));
    usedByOthers = colWidths.reduce((sum, w) => sum + w, 0);
  }
  // Floor at MIN_COLUMN_WIDTH rather than MAX_REGULAR_COLUMN_WIDTH: flooring the *widest*
  // column at 32 meant a 3-column table could never render narrower than ~57 columns, so a
  // genuinely narrow terminal was guaranteed to wrap.
  colWidths[widestColumn] = Math.max(available - usedByOthers, MIN_COLUMN_WIDTH);

  const table = new Table({
    head: headers.map((h) => chalk.gray.bold(h)),
    style: { head: [], border: [] },
    colWidths,
    wordWrap: true,
  });
  for (const row of rows) table.push(row);
  return table.toString();
}
