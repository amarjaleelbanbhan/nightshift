import { select, text, confirm, isCancel, cancel, intro, outro, note, log } from "@clack/prompts";

export { intro, outro, note, log };

/**
 * Wraps @clack/prompts' select so every call site handles Escape/Ctrl+C the same way: both
 * produce the same cancellation signal in clack (it doesn't distinguish the two keys), so
 * cancelling returns null here rather than throwing or exposing clack's cancel symbol.
 * Returning from a submenu on null naturally reads as "back" one level; cancelling at the
 * outermost menu reads as "exit" - no custom key-handling code needed.
 */
export async function promptSelect<T extends string>(
  message: string,
  options: Array<{ label: string; value: T; hint?: string }>,
): Promise<T | null> {
  // clack's Option<Value> is `Value extends Primitive ? ... : ...` - a conditional type that
  // TS can't resolve against our generic T, so we build the options with a concrete `string`
  // value type (letting clack infer Value = string) and cast the result back to T: every
  // value in `options` came from a T, so whatever select() returns (when not cancelled) is one.
  const clackOptions: Array<{ value: string; label: string; hint?: string }> = options.map((o) => {
    const opt: { value: string; label: string; hint?: string } = { value: o.value, label: o.label };
    if (o.hint !== undefined) opt.hint = o.hint;
    return opt;
  });
  const result = await select({ message, options: clackOptions });
  if (isCancel(result)) {
    cancel("Cancelled.");
    return null;
  }
  return result as T;
}

export async function promptText(message: string, placeholder?: string): Promise<string | null> {
  const result = await text(placeholder ? { message, placeholder } : { message });
  if (isCancel(result)) {
    cancel("Cancelled.");
    return null;
  }
  return result;
}

export async function promptConfirm(message: string): Promise<boolean> {
  const result = await confirm({ message });
  if (isCancel(result)) {
    cancel("Cancelled.");
    return false;
  }
  return result;
}
