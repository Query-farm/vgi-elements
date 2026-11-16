/**
 * Table function `formula_composition(formula)`: one row per element of a
 * chemical formula with its atom count and mass fraction.
 *
 * Unlike the scalar formula_mass (NULL on bad input), this raises an error
 * naming the problem and its position, because the formula is a single
 * constant the caller can fix.
 */

import {
  batchFromColumns,
  defineTableFunction,
  FunctionStability,
  float64,
  int32,
  int64,
  schema,
  utf8,
} from "@query-farm/vgi";
import { FormulaError, formulaComposition } from "./chem.ts";
import { column, objectTags } from "./meta.ts";

export const COMPOSITION_SCHEMA = schema([
  column("element", utf8(), "Element symbol as written in the formula ('Cu').", false),
  column("atomic_number", int32, "Atomic number; joins to elements.atomic_number.", false),
  column("count", int64(), "Total atoms of this element in one formula unit, after groups and hydrates.", false),
  column("atomic_mass", float64(), "Atomic mass of the element in g/mol (elements.atomic_mass).", false),
  column("mass", float64(), "count times atomic_mass: this element's g/mol in the formula.", false),
  column("mass_fraction", float64(), "mass divided by the formula mass, 0-1; fractions sum to 1.", false),
]);

const RESULT_COLUMNS = [
  { name: "element", type: "VARCHAR", description: "Element symbol." },
  { name: "atomic_number", type: "INTEGER", description: "Atomic number." },
  { name: "count", type: "BIGINT", description: "Atoms of the element per formula unit." },
  { name: "atomic_mass", type: "DOUBLE", description: "Atomic mass in g/mol." },
  { name: "mass", type: "DOUBLE", description: "count * atomic_mass in g/mol." },
  { name: "mass_fraction", type: "DOUBLE", description: "Share of the formula mass, 0-1." },
];

interface Args {
  formula: string;
}

export const formulaCompositionFn = defineTableFunction<Args, { done: boolean }>({
  name: "formula_composition",
  description: "Break a chemical formula into elements with atom counts and mass fractions",
  args: { formula: utf8() },
  argDocs: {
    formula:
      "Chemical formula text: case-sensitive element symbols with whole-number subscripts, bracket groups and " +
      "hydrate parts (see the function documentation for the syntax). An invalid formula raises an error.",
  },
  stability: FunctionStability.CONSISTENT,
  onBind: ({ args }) => {
    if (args.formula == null) throw new Error("formula_composition: formula must not be NULL");
    try {
      formulaComposition(args.formula);
    } catch (e) {
      if (e instanceof FormulaError) throw new Error(`formula_composition: ${e.message}`);
      throw e;
    }
    return { outputSchema: COMPOSITION_SCHEMA };
  },
  initialState: () => ({ done: false }),
  process: (params, state, out) => {
    if (state.done) {
      out.finish();
      return;
    }
    state.done = true;
    const rows = formulaComposition(params.args.formula);
    out.emit(
      batchFromColumns(
        {
          element: rows.map((r) => r.element),
          atomic_number: rows.map((r) => r.atomic_number),
          count: rows.map((r) => r.count),
          atomic_mass: rows.map((r) => r.atomic_mass),
          mass: rows.map((r) => r.mass),
          mass_fraction: rows.map((r) => r.mass_fraction),
        },
        params.outputSchema,
      ),
    );
  },
  tags: {
    ...objectTags({
      title: "Formula Composition",
      category: "formulas",
      keywords:
        "elemental composition, mass percent, mass fraction, chemical formula, atom count, stoichiometry, hydrate",
      docLlm:
        "Parse a chemical formula and return one row per element, in order of first appearance, with " +
        "columns element, atomic_number, count (`BIGINT` atoms per formula unit), atomic_mass, mass " +
        "(count * atomic_mass, g/mol) and mass_fraction (0-1, summing to 1). Groups in (), [] or {} " +
        "multiply by their subscript; hydrate parts after '·', '*' or '.' are added with their " +
        "coefficient, so 'CuSO4·5H2O' gives Cu 1, S 1, O 9, H 10. Symbols are case-sensitive. An " +
        "invalid formula raises an error that names the problem and its position. sum(mass) equals " +
        "formula_mass(formula). Multiply mass_fraction by 100 for mass percent.",
      docMd:
        "## formula_composition(formula)\n\nElemental breakdown of a formula: atom counts, g/mol per " +
        "element and mass fraction.\n\n| Column | Meaning |\n| --- | --- |\n" +
        RESULT_COLUMNS.map((c) => `| ${c.name} | ${c.description} |`).join("\n"),
    }),
    "vgi.result_columns_schema": JSON.stringify(RESULT_COLUMNS),
    "vgi.executable_examples": JSON.stringify([
      {
        description: "Atom counts of copper sulfate pentahydrate",
        sql: "SELECT element, count FROM elements.main.formula_composition('CuSO4·5H2O') ORDER BY element",
        expected_result: [
          ["Cu", 1],
          ["H", 10],
          ["O", 9],
          ["S", 1],
        ],
      },
    ]),
  },
  examples: [
    {
      sql:
        "SELECT element, count, round(100 * mass_fraction, 2) AS mass_percent " +
        "FROM elements.main.formula_composition('C9H8O4') ORDER BY mass_percent DESC",
      description: "Mass percent of each element in aspirin",
    },
    {
      sql: "SELECT element, count FROM elements.main.formula_composition('CuSO4·5H2O') ORDER BY element",
      description: "Atom counts of copper sulfate pentahydrate",
    },
  ],
});
