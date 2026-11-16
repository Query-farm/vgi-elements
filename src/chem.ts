/**
 * Pure chemistry logic: element lookup and chemical-formula parsing.
 *
 * No I/O and no Node APIs: the data is imported as JSON modules so the worker
 * also bundles for the browser (Haybarn WASM).
 */

import type { ElementRow, IsotopeRow } from "../tools/build-data.ts";
import elementRows from "./data/elements.json";
import isotopeRows from "./data/isotopes.json";

export type { ElementRow, IsotopeRow };

export const ELEMENTS = elementRows as ElementRow[];
export const ISOTOPES = isotopeRows as IsotopeRow[];

const BY_NUMBER = new Map<number, ElementRow>(ELEMENTS.map((e) => [e.atomic_number, e]));
const BY_SYMBOL = new Map<string, ElementRow>(ELEMENTS.map((e) => [e.symbol, e]));
/** Case-insensitive symbol or English name (IUPAC spelling, plus common variants). */
const BY_KEY = new Map<string, ElementRow>();
for (const e of ELEMENTS) {
  BY_KEY.set(e.symbol.toLowerCase(), e);
  BY_KEY.set(e.name.toLowerCase(), e);
}
const ALIASES: Record<string, string> = { aluminium: "Al", aluminum: "Al", caesium: "Cs", cesium: "Cs", sulphur: "S" };
for (const [alias, symbol] of Object.entries(ALIASES)) {
  const e = BY_SYMBOL.get(symbol);
  if (e) BY_KEY.set(alias, e);
}

/** Element by atomic number (1-118), or undefined. */
export function byNumber(z: number | bigint): ElementRow | undefined {
  return BY_NUMBER.get(Number(z));
}

/** Element by symbol or name, case-insensitive and trimmed, or undefined. */
export function byKey(key: string): ElementRow | undefined {
  return BY_KEY.get(key.trim().toLowerCase());
}

/** Element by exact, case-sensitive symbol (as written in a formula). */
export function bySymbol(symbol: string): ElementRow | undefined {
  return BY_SYMBOL.get(symbol);
}

export class FormulaError extends Error {}

/** Separators between hydrate / adduct parts: CuSO4·5H2O, CuSO4*5H2O, CuSO4.5H2O. */
const SEPARATORS = new Set(["·", "•", "∙", "⋅", "*", "."]);
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const MAX_COUNT = 1_000_000_000;

/**
 * Parse a chemical formula into element counts, in order of first appearance.
 *
 * Supports element symbols (case-sensitive: `Co` is cobalt, `CO` is carbon +
 * oxygen), integer subscripts, nested (), [] and {} groups, a leading integer
 * coefficient, and hydrate separators (`·`, `•`, `*`, `.`) each followed by an
 * optional coefficient. Whitespace is ignored. Throws FormulaError otherwise.
 */
export function parseFormula(formula: string): Map<string, number> {
  const s = formula.replace(/\s+/g, "");
  if (s === "") throw new FormulaError("empty formula");
  let i = 0;
  const fail = (msg: string): never => {
    throw new FormulaError(`invalid formula ${JSON.stringify(formula)}: ${msg} at position ${i + 1}`);
  };
  const readInt = (): number | null => {
    const m = /^\d+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const v = Number(m[0]);
    if (v === 0) fail("count must be at least 1");
    if (v > MAX_COUNT) fail("count too large");
    return v;
  };
  const add = (into: Map<string, number>, from: Map<string, number>, k: number) => {
    for (const [sym, n] of from) into.set(sym, (into.get(sym) ?? 0) + n * k);
  };
  const parseGroup = (close: string | null): Map<string, number> => {
    const out = new Map<string, number>();
    let any = false;
    while (i < s.length) {
      const c = s[i] ?? "";
      if (close !== null && c === close) break;
      if (SEPARATORS.has(c)) break;
      if (c in OPEN) {
        i++;
        const want = OPEN[c] ?? "";
        const inner = parseGroup(want);
        if (s[i] !== want) fail(`missing '${want}'`);
        i++;
        add(out, inner, readInt() ?? 1);
        any = true;
      } else if (/[A-Z]/.test(c)) {
        const m = /^[A-Z][a-z]*/.exec(s.slice(i));
        const sym = m?.[0] ?? c;
        if (!bySymbol(sym)) fail(`unknown element symbol '${sym}'`);
        i += sym.length;
        out.set(sym, (out.get(sym) ?? 0) + (readInt() ?? 1));
        any = true;
      } else if (c === ")" || c === "]" || c === "}") {
        fail(`unexpected '${c}'`);
      } else {
        fail(`unexpected character '${c}'`);
      }
    }
    if (!any) fail("expected an element symbol or group");
    return out;
  };
  const total = new Map<string, number>();
  for (;;) {
    const k = readInt() ?? 1;
    add(total, parseGroup(null), k);
    if (i >= s.length) break;
    if (SEPARATORS.has(s[i] ?? "")) {
      i++;
      if (i >= s.length) fail("nothing after separator");
      continue;
    }
    fail(`unexpected '${s[i]}'`);
  }
  for (const n of total.values()) if (n > Number.MAX_SAFE_INTEGER) throw new FormulaError("count too large");
  return total;
}

/** Molar mass (g/mol) from the bundled atomic_mass values. */
export function formulaMass(formula: string): number {
  let m = 0;
  for (const [sym, n] of parseFormula(formula)) m += n * (bySymbol(sym)?.atomic_mass ?? Number.NaN);
  return m;
}

export interface CompositionRow {
  element: string;
  atomic_number: number;
  count: bigint;
  atomic_mass: number;
  mass: number;
  mass_fraction: number;
}

/** Per-element breakdown of a formula, in order of first appearance. */
export function formulaComposition(formula: string): CompositionRow[] {
  const counts = parseFormula(formula);
  const rows: CompositionRow[] = [];
  let total = 0;
  for (const [sym, n] of counts) {
    const e = bySymbol(sym);
    if (!e) throw new FormulaError(`unknown element symbol '${sym}'`);
    const mass = n * e.atomic_mass;
    total += mass;
    rows.push({
      element: sym,
      atomic_number: e.atomic_number,
      count: BigInt(n),
      atomic_mass: e.atomic_mass,
      mass,
      mass_fraction: 0,
    });
  }
  for (const r of rows) r.mass_fraction = r.mass / total;
  return rows;
}
