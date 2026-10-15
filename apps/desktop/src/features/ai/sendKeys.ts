import { HIDDEN } from "./commandRules";

/** AI-13: key names accepted by send_input. Printable characters are keys too. */
export const NAMED_SEND_KEYS = ["enter", "tab", "esc", "up", "down", "left", "right", "home", "end", "page_up", "page_down", "insert", "delete", "backspace", "space", ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)] as const;
export const SEND_KEYS: readonly string[] = [...NAMED_SEND_KEYS, "shift+tab", ...Array.from("abcdefghijklmnopqrstuvwxyz", (c) => `ctrl+${c}`), ...Array.from("abcdefghijklmnopqrstuvwxyz", (c) => `alt+${c}`)];
export const SEND_KEY_NOTATION = `a single printable character, ctrl+a through ctrl+z, alt+character (for example alt+f or alt++), shift+tab, or ${NAMED_SEND_KEYS.join(", ")}`;
/** Validated by parseSendKey before terminal input is sent. */
export type SendKey = string;

const CURSOR: Record<string, string> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" };
const TILDE: Record<string, number> = { insert: 2, delete: 3, page_up: 5, page_down: 6, f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 };
const CONTROL: Record<string, number> = { space: 0, "@": 0, "[": 27, "\\": 28, "]": 29, "^": 30, "_": 31, "?": 127 };

/** Keep a literal + as the base of a modified key such as alt++. */
function keyParts(key: string): string[] {
  if (key === "+") return [key];
  return key.endsWith("++") ? [...key.slice(0, -2).split("+"), "+"] : key.split("+");
}

/** Normalize the legacy ctrl_c/ctrl_d notation and named keys, without lowercasing literal text. */
export function parseSendKey(value: unknown): SendKey | null {
  if (typeof value !== "string" || !value || HIDDEN.test(value)) return null;
  const raw = Array.from(value).length === 1 ? value : value.replace(/^(ctrl|alt|shift)_/i, "$1+");
  const parts = keyParts(raw);
  const base = parts.pop() ?? "";
  const modifiers = parts.map((p) => p.toLowerCase());
  if (new Set(modifiers).size !== modifiers.length || modifiers.some((p) => !["ctrl", "alt", "shift"].includes(p))) return null;
  const name = Array.from(base).length === 1 ? base : base.toLowerCase();
  const key = [...["ctrl", "alt", "shift"].filter((p) => modifiers.includes(p)), name].join("+");
  return encodeKey(name, modifiers, false) === null ? null : key;
}

/** xterm.js Keyboard.ts: DECCKM for cursor keys, SS3 for F1–F4, CSI for the other named keys. */
function encodeKey(base: string, modifiers: readonly string[], applicationCursor: boolean): string | null {
  const ctrl = modifiers.includes("ctrl"), alt = modifiers.includes("alt"), shift = modifiers.includes("shift");
  const modifier = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const prefix = alt ? "\x1b" : "";
  if (Object.hasOwn(CURSOR, base)) return modifier > 1 ? `\x1b[1;${modifier}${CURSOR[base]}` : `\x1b${applicationCursor ? "O" : "["}${CURSOR[base]}`;
  if (/^f[1-4]$/.test(base)) {
    const final = "PQRS"[Number(base.slice(1)) - 1];
    return modifier > 1 ? `\x1b[1;${modifier}${final}` : `\x1bO${final}`;
  }
  if (Object.hasOwn(TILDE, base)) return `\x1b[${TILDE[base]}${modifier > 1 ? `;${modifier}` : ""}~`;
  if (base === "enter") return prefix + "\r";
  if (base === "tab") return shift ? "\x1b[Z" : "\t";
  if (base === "esc") return prefix + "\x1b";
  if (base === "backspace") return prefix + (ctrl ? "\b" : "\x7f");
  if (ctrl) {
    if (/^[a-z]$/i.test(base)) return prefix + String.fromCharCode(base.toUpperCase().charCodeAt(0) - 64);
    return Object.hasOwn(CONTROL, base) ? prefix + String.fromCharCode(CONTROL[base]) : null;
  }
  if (base === "space") return prefix + " ";
  const code = base.codePointAt(0) ?? 0;
  if (Array.from(base).length !== 1 || code < 32 || /[\p{C}\p{Zl}\p{Zp}]/u.test(base)) return null;
  return prefix + (shift ? base.toUpperCase() : base);
}

/** The bytes of a validated key; legacy single-key callers can still use ctrl_c and ctrl_d. */
export function keySequence(key: SendKey, applicationCursor: boolean): string {
  const normalized = parseSendKey(key);
  if (normalized === null) throw new Error(`Unsupported terminal key: ${key}`);
  const parts = keyParts(normalized);
  const base = parts.pop()!;
  return encodeKey(base, parts, applicationCursor)!;
}

/** Visible, reversible notation for terminal controls, including in the approval editor. */
export function showTerminalInput(text: string, escapeBackslashes = true): string {
  return text.replace(/[\\^\x00-\x09\x0b-\x1f\x7f-\x9f]/g, (c) => {
    if (c === "\\") return escapeBackslashes ? "\\\\" : "\\";
    if (c === "^") return escapeBackslashes ? "\\^" : "^";
    if (c === "\x1b") return "\\e";
    if (c === "\t") return "\\t";
    if (c === "\r") return "\\r";
    if (c === "\x7f") return "\\x7f";
    if (c.charCodeAt(0) < 32) return `^${String.fromCharCode(c.charCodeAt(0) + 64)}`;
    return `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}

/** Decode only the explicit escapes shown by showTerminalInput; other backslashes remain literal. */
export function readTerminalInput(text: string): string {
  return text.replace(/\\(\\|\^|e|t|r|x[0-9a-f]{2})|\^([@A-Z[\\\]^_])/g, (_, escape: string | undefined, control: string | undefined) => {
    if (control) return String.fromCharCode(control.charCodeAt(0) - 64);
    if (escape === undefined) return "";
    switch (escape.toLowerCase()) {
      case "\\": return "\\";
      case "^": return "^";
      case "e": return "\x1b";
      case "t": return "\t";
      case "r": return "\r";
      default: return String.fromCharCode(parseInt(escape.slice(1), 16));
    }
  });
}
