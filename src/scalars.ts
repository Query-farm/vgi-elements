/**
 * Scalar lookups over the bundled periodic table, plus formula_mass.
 *
 * Every scalar is NULL-in/NULL-out, and returns NULL (never an error) for an
 * unknown element or an unparseable formula, so one bad row does not abort a
 * whole column. Use the `formula_composition` table function to see why a
 * formula was rejected: it raises an error with the position.
 *
 * Optional input types are overloads (scalars have no named arguments):
 * `element_name(26)` and `element_name('Fe')` are two functions with one name.
 */

import { defineScalarFunction, FunctionStability, float64, int32, int64, utf8, type VgiBatch } from "@query-farm/vgi";
import { byKey, byNumber, type ElementRow, FormulaError, formulaMass } from "./chem.ts";
import { objectTags } from "./meta.ts";

const NUMBER_DOC = "Atomic number (proton count) of the element. NULL, or a number with no element, gives NULL.";
const KEY_DOC =
  "Element symbol ('Fe') or English name ('Iron'), case-insensitive; surrounding spaces are ignored. " +
  "Unknown values give NULL.";

function col<T>(batch: VgiBatch): Iterable<T | null> {
  return (batch.getChildAt(0) ?? []) as Iterable<T | null>;
}

function mapNumbers<R>(batch: VgiBatch, f: (e: ElementRow) => R): (R | null)[] {
  return Array.from(col<bigint | number>(batch), (z) => {
    if (z == null) return null;
    const e = byNumber(z);
    return e ? f(e) : null;
  });
}

function mapKeys<R>(batch: VgiBatch, f: (e: ElementRow) => R): (R | null)[] {
  return Array.from(col<string>(batch), (k) => {
    if (k == null) return null;
    const e = byKey(k);
    return e ? f(e) : null;
  });
}

const common = { stability: FunctionStability.CONSISTENT };

export const elementSymbol = defineScalarFunction({
  ...common,
  name: "element_symbol",
  description: "Chemical symbol for an atomic number: element_symbol(26) returns 'Fe'",
  params: { atomic_number: int64() },
  argDocs: { atomic_number: NUMBER_DOC },
  returns: utf8(),
  compute: (batch) => mapNumbers(batch, (e) => e.symbol),
  tags: objectTags({
    title: "Element Symbol",
    category: "lookup",
    keywords: "element symbol, atomic number to symbol, periodic table lookup, chemical symbol",
    docLlm:
      "Map an atomic number (1-118) to its IUPAC chemical symbol, e.g. 26 -> 'Fe', 118 -> 'Og'. " +
      "Out-of-range numbers and NULL give NULL. Vectorized: pass a column of atomic numbers.",
    docMd:
      "## element_symbol(atomic_number)\n\nReturns the chemical symbol, so `element_symbol(79)` is `'Au'`. " +
      "Numbers outside 1-118 return NULL rather than raising an error.",
  }),
  examples: [
    {
      sql: "SELECT z, elements.main.element_symbol(z) AS symbol FROM range(1, 11) t(z) ORDER BY z",
      description: "Symbols of the first ten elements",
    },
  ],
});

export const elementNameByNumber = defineScalarFunction({
  ...common,
  name: "element_name",
  description: "English element name for an atomic number: element_name(26) returns 'Iron'",
  params: { atomic_number: int64() },
  argDocs: { atomic_number: NUMBER_DOC },
  returns: utf8(),
  compute: (batch) => mapNumbers(batch, (e) => e.name),
  tags: objectTags({
    title: "Element Name (by number)",
    category: "lookup",
    keywords: "element name, atomic number to name, periodic table lookup",
    docLlm:
      "Return the IUPAC English name for an atomic number, e.g. 26 -> 'Iron'. This is the integer " +
      "overload; element_name('Fe') looks up by symbol or name instead. Unknown input gives NULL.",
    docMd:
      "## element_name(atomic_number)\n\nThe element's English name, so `element_name(8)` is `'Oxygen'`. " +
      "Use `element_name(symbol)` to start from a symbol.",
  }),
  examples: [{ sql: "SELECT elements.main.element_name(118) AS name", description: "Name of element 118" }],
});

export const elementNameByKey = defineScalarFunction({
  ...common,
  name: "element_name",
  description: "English element name for a symbol or name: element_name('fe') returns 'Iron'",
  params: { symbol_or_name: utf8() },
  argDocs: { symbol_or_name: KEY_DOC },
  returns: utf8(),
  compute: (batch) => mapKeys(batch, (e) => e.name),
  tags: objectTags({
    title: "Element Name (by symbol)",
    category: "lookup",
    keywords: "element name, symbol to name, normalize element name, periodic table lookup",
    docLlm:
      "Return the canonical IUPAC English name for a symbol or name, case-insensitive: 'fe' -> 'Iron', " +
      "'ALUMINUM' -> 'Aluminum', 'sulphur' -> 'Sulfur'. Useful to normalize messy element columns. " +
      "Unknown values give NULL.",
    docMd:
      "## element_name(symbol_or_name)\n\nCanonical name from a symbol or name, ignoring case. " +
      "Accepts the spellings aluminium/aluminum, caesium/cesium and sulphur/sulfur.",
  }),
  examples: [
    {
      sql: "SELECT s, elements.main.element_name(s) AS name FROM (VALUES ('fe'), ('AU'), ('Na')) t(s) ORDER BY s",
      description: "Normalize symbols to names",
    },
  ],
});

export const atomicMassByNumber = defineScalarFunction({
  ...common,
  name: "atomic_mass",
  description: "Atomic mass in g/mol (Da) for an atomic number: atomic_mass(26) returns 55.845",
  params: { atomic_number: int64() },
  argDocs: { atomic_number: NUMBER_DOC },
  returns: float64(),
  compute: (batch) => mapNumbers(batch, (e) => e.atomic_mass),
  tags: objectTags({
    title: "Atomic Mass (by number)",
    category: "lookup",
    keywords: "atomic mass, atomic weight, molar mass of element, g/mol, dalton",
    docLlm:
      "Return the element's atomic mass (g/mol) as a DOUBLE, the same value as elements.atomic_mass: " +
      "the NIST standard atomic weight, the IUPAC conventional value for elements published as an " +
      "interval (H 1.008, C 12.011, O 15.999), or the longest-lived isotope's mass for elements " +
      "without a standard atomic weight. Unknown input gives NULL.",
    docMd:
      "## atomic_mass(atomic_number)\n\nAtomic mass in g/mol, so `atomic_mass(26)` is `55.845`. " +
      "See the `atomic_mass_basis` column of the elements table for where each value comes from.",
  }),
  examples: [{ sql: "SELECT elements.main.atomic_mass(26) AS iron", description: "Atomic mass of iron" }],
});

export const atomicMassByKey = defineScalarFunction({
  ...common,
  name: "atomic_mass",
  description: "Atomic mass in g/mol (Da) for a symbol or name: atomic_mass('Fe') returns 55.845",
  params: { symbol_or_name: utf8() },
  argDocs: { symbol_or_name: KEY_DOC },
  returns: float64(),
  compute: (batch) => mapKeys(batch, (e) => e.atomic_mass),
  tags: objectTags({
    title: "Atomic Mass (by symbol)",
    category: "lookup",
    keywords: "atomic mass, atomic weight, element mass by symbol, g/mol",
    docLlm:
      "Return the atomic mass (g/mol) for a symbol or name, case-insensitive: 'Fe' -> 55.845, " +
      "'carbon' -> 12.011. For a compound use formula_mass instead. Unknown values give NULL.",
    docMd:
      "## atomic_mass(symbol_or_name)\n\nAtomic mass in g/mol from a symbol or name. " +
      "For molecules, use `formula_mass(formula)`.",
  }),
  examples: [
    {
      sql: "SELECT elements.main.atomic_mass('Au') / elements.main.atomic_mass('Ag') AS gold_to_silver",
      description: "Ratio of gold's atomic mass to silver's",
    },
  ],
});

export const atomicNumber = defineScalarFunction({
  ...common,
  name: "atomic_number",
  description: "Atomic number for a symbol or name, case-insensitive: atomic_number('iron') returns 26",
  params: { symbol_or_name: utf8() },
  argDocs: { symbol_or_name: KEY_DOC },
  returns: int32,
  compute: (batch) => mapKeys(batch, (e) => e.atomic_number),
  tags: objectTags({
    title: "Atomic Number",
    category: "lookup",
    keywords: "atomic number, proton number, Z, symbol to number, element name to number",
    docLlm:
      "Return the atomic number (`INTEGER`) for an element symbol or English name, case-insensitive: " +
      "'Fe', 'fe' and 'Iron' all give 26. Use it to join free-text element columns to the elements " +
      "table on atomic_number. Unknown values give NULL.",
    docMd:
      "## atomic_number(symbol_or_name)\n\nThe proton count, so `atomic_number('Og')` is `118`. " +
      "Returns NULL for anything that is not an element.",
  }),
  examples: [
    {
      sql: "SELECT elements.main.atomic_number('oganesson') AS z",
      description: "Atomic number of oganesson",
    },
  ],
});

export const formulaMassFn = defineScalarFunction({
  ...common,
  name: "formula_mass",
  description: "Molar mass in g/mol of a chemical formula: formula_mass('H2O') returns about 18.015",
  params: { formula: utf8() },
  argDocs: {
    formula:
      "Chemical formula text: case-sensitive element symbols with whole-number subscripts, bracket groups and " +
      "hydrate parts (see the function documentation for the syntax). Invalid formulas give NULL.",
  },
  returns: float64(),
  compute: (batch) =>
    Array.from(col<string>(batch), (f) => {
      if (f == null) return null;
      try {
        return formulaMass(f);
      } catch (e) {
        if (e instanceof FormulaError) return null;
        throw e;
      }
    }),
  tags: objectTags({
    title: "Formula Mass",
    category: "formulas",
    keywords: "molar mass, molecular weight, formula weight, chemical formula, stoichiometry, hydrate",
    docLlm:
      "Compute the molar mass (g/mol, `DOUBLE`) of a chemical formula by summing atomic_mass over its " +
      "atoms. Supports nested (), [] and {} groups with subscripts, a leading coefficient ('2H2O'), " +
      "and hydrates joined by '·', '*' or '.' with their own coefficient ('CuSO4·5H2O', " +
      "'CuSO4*5H2O'). Symbols are case-sensitive ('Co' is cobalt, 'CO' carbon monoxide). Charges, " +
      "isotope labels (D, 13C) and fractional subscripts are not supported. An invalid formula " +
      "returns NULL instead of failing the query; call formula_composition(formula) to see the error. " +
      "Examples: H2O = 18.015, C9H8O4 (aspirin) = 180.159.",
    docMd:
      "## formula_mass(formula)\n\nMolar mass in g/mol. `formula_mass('C9H8O4')` is about 180.16.\n\n" +
      "Handles parentheses and brackets, coefficients and hydrates. Returns NULL for invalid input; " +
      "`formula_composition` reports the reason.",
  }),
  examples: [
    {
      sql:
        "SELECT f, round(elements.main.formula_mass(f), 3) AS g_per_mol " +
        "FROM (VALUES ('H2O'), ('C9H8O4'), ('CuSO4·5H2O')) t(f) ORDER BY f",
      description: "Molar masses of water, aspirin and copper sulfate pentahydrate",
    },
    {
      sql: "SELECT round(1000 / elements.main.formula_mass('NaCl'), 2) AS mol_per_kg",
      description: "Moles of sodium chloride in one kilogram",
    },
  ],
});

export const SCALARS = [
  elementSymbol,
  elementNameByNumber,
  elementNameByKey,
  atomicMassByNumber,
  atomicMassByKey,
  atomicNumber,
  formulaMassFn,
];
