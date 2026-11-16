/**
 * Catalog tables `elements` and `isotopes`: the bundled reference data,
 * queried by name with no arguments (`SELECT * FROM elements.main.elements`).
 *
 * The data is tiny (118 and 3,352 rows) and in memory, so every scan emits the
 * whole table in one batch; DuckDB applies filters, and the SDK applies
 * projection pushdown. Constraints are ENFORCED/ALL_ROWS because the bundle is
 * validated when it is built (tools/build-data.ts) and in the unit tests.
 */

import {
  batchFromColumns,
  bool,
  constraintRecord,
  defineTableFunction,
  float64,
  int32,
  list,
  schema,
  type TableDescriptor,
  utf8,
  type VgiDataType,
  type VgiSchema,
} from "@query-farm/vgi";
import { ELEMENTS, ISOTOPES } from "./chem.ts";
import { type Category, column, objectTags } from "./meta.ts";

type SqlType = "VARCHAR" | "INTEGER" | "DOUBLE" | "BOOLEAN" | "INTEGER[]" | "VARCHAR[]";
type Column = readonly [name: string, type: SqlType, description: string, nullable: boolean];

const TYPES: Record<SqlType, () => VgiDataType> = {
  VARCHAR: utf8,
  INTEGER: () => int32,
  DOUBLE: float64,
  BOOLEAN: () => bool,
  "INTEGER[]": () => list(int32),
  "VARCHAR[]": () => list(utf8()),
};

function outputSchema(columns: readonly Column[]): VgiSchema {
  return schema(columns.map(([name, type, doc, nullable]) => column(name, TYPES[type](), doc, nullable)));
}

export const ELEMENT_COLUMNS: Column[] = [
  ["atomic_number", "INTEGER", "Atomic number Z (proton count), 1-118. Primary key.", false],
  ["symbol", "VARCHAR", "IUPAC chemical symbol, case-sensitive ('Fe').", false],
  ["name", "VARCHAR", "English element name as published by PubChem ('Iron', 'Aluminum', 'Cesium').", false],
  [
    "atomic_mass",
    "DOUBLE",
    "Atomic mass in g/mol (Da): see atomic_mass_basis. Fe = 55.845, C = 12.011 (conventional).",
    false,
  ],
  [
    "atomic_mass_basis",
    "VARCHAR",
    "Where atomic_mass comes from: 'standard_atomic_weight' (NIST value), 'conventional_atomic_weight' " +
      "(IUPAC conventional value for interval elements) or 'longest_lived_isotope' (no stable isotopes).",
    false,
  ],
  [
    "standard_atomic_weight",
    "VARCHAR",
    "NIST standard atomic weight as published: '55.845(2)' (uncertainty in last digits), an interval " +
      "'[12.0096,12.0116]', or '[98]' (mass number of the longest-lived isotope); NULL when none is assigned.",
    true,
  ],
  [
    "atomic_weight_notes",
    "VARCHAR[]",
    "NIST/IUPAC footnotes on the atomic weight: 'g' geologically exceptional samples, 'm' modified " +
      "isotopic compositions in commercial material, 'r' range in natural composition. Empty when none.",
    false,
  ],
  [
    "group_number",
    "INTEGER",
    "IUPAC group 1-18 (derived from Z). NULL for the lanthanides (La-Lu) and actinides (Ac-Lr).",
    true,
  ],
  ["period", "INTEGER", "Period (row) 1-7, derived from Z.", false],
  [
    "block",
    "VARCHAR",
    "Periodic-table block 's', 'p', 'd' or 'f' (derived; La-Lu and Ac-Lr are 'f', matching group_number).",
    false,
  ],
  [
    "group_block",
    "VARCHAR",
    "PubChem category: 'Alkali metal', 'Alkaline earth metal', 'Transition metal', 'Post-transition metal', " +
      "'Metalloid', 'Nonmetal', 'Halogen', 'Noble gas', 'Lanthanide' or 'Actinide'.",
    false,
  ],
  ["electron_configuration", "VARCHAR", "Ground-state electron configuration, e.g. '[Ar]4s2 3d6'.", false],
  [
    "electronegativity_pauling",
    "DOUBLE",
    "Electronegativity on the dimensionless Pauling scale (fluorine 3.98); NULL where not measured.",
    true,
  ],
  ["atomic_radius_pm", "DOUBLE", "Atomic (van der Waals) radius in picometres, as given by PubChem.", true],
  ["ionization_energy_ev", "DOUBLE", "First ionization energy in electronvolts.", true],
  ["electron_affinity_ev", "DOUBLE", "Electron affinity in electronvolts; NULL where unknown.", true],
  [
    "oxidation_states",
    "INTEGER[]",
    "Common oxidation states (formal charge per atom, an integer count of electrons) as published by PubChem, e.g. [3, 2] for iron; NULL if none listed.",
    true,
  ],
  [
    "standard_state",
    "VARCHAR",
    "State at standard conditions: 'Solid', 'Liquid' or 'Gas' (expected state for superheavy elements).",
    false,
  ],
  [
    "properties_predicted",
    "BOOLEAN",
    "True when PubChem marks the state or electron configuration as predicted/expected (superheavies).",
    false,
  ],
  ["melting_point_k", "DOUBLE", "Melting point in kelvin.", true],
  ["boiling_point_k", "DOUBLE", "Boiling point in kelvin.", true],
  ["density", "DOUBLE", "Density in g/cm3 at standard conditions (gases too, so hydrogen is 0.00008988).", true],
  [
    "year_discovered",
    "INTEGER",
    "Year of discovery; NULL for elements known since antiquity (see discovered_in_antiquity).",
    true,
  ],
  ["discovered_in_antiquity", "BOOLEAN", "True for elements PubChem lists as discovered in 'Ancient' times.", false],
  ["cpk_hex_color", "VARCHAR", "CPK/Jmol molecular-model colour as 6 hex digits, e.g. 'E06633'; NULL if none.", true],
];

export const ISOTOPE_COLUMNS: Column[] = [
  [
    "atomic_number",
    "INTEGER",
    "Atomic number Z: count of protons in the nucleus; joins to elements.atomic_number.",
    false,
  ],
  ["symbol", "VARCHAR", "Element symbol (deuterium and tritium are listed under 'H').", false],
  ["mass_number", "INTEGER", "Mass number A (protons + neutrons).", false],
  ["nuclide", "VARCHAR", "Nuclide label symbol-A, e.g. 'Fe-56', 'H-2'. Unique.", false],
  ["relative_atomic_mass", "DOUBLE", "NIST relative atomic mass of the nuclide in u (Da).", false],
  [
    "relative_atomic_mass_uncertainty",
    "DOUBLE",
    "Standard uncertainty of relative_atomic_mass in u; 0 for C-12, which is exact by definition.",
    true,
  ],
  [
    "relative_atomic_mass_estimated",
    "BOOLEAN",
    "True when NIST marks the mass '#' (estimated from systematic trends, not measured).",
    false,
  ],
  [
    "isotopic_composition",
    "DOUBLE",
    "Representative terrestrial isotopic composition as a mole fraction 0-1; NULL when the nuclide has " +
      "no representative natural abundance (most radioactive isotopes).",
    true,
  ],
  [
    "isotopic_composition_uncertainty",
    "DOUBLE",
    "Standard uncertainty of isotopic_composition, in mole-fraction units (0-1); NULL when absent.",
    true,
  ],
  [
    "is_most_abundant",
    "BOOLEAN",
    "True for the isotope with the largest isotopic_composition of its element (false for elements with none).",
    false,
  ],
];

const ELEMENT_SCHEMA = outputSchema(ELEMENT_COLUMNS);
const ISOTOPE_SCHEMA = outputSchema(ISOTOPE_COLUMNS);

function columnsOf(rows: readonly object[], output: VgiSchema): Record<string, unknown[]> {
  return Object.fromEntries(
    output.fields.map((f) => [f.name, rows.map((r) => (r as Record<string, unknown>)[f.name] ?? null)]),
  );
}

function resultColumnsTag(columns: readonly Column[]): string {
  return JSON.stringify(columns.map(([name, type, description]) => ({ name, type, description })));
}

function docTable(columns: readonly Column[]): string {
  return `| Column | Type | Meaning |\n| --- | --- | --- |\n${columns
    .map(([n, t, d]) => `| ${n} | ${t} | ${d} |`)
    .join("\n")}`;
}

interface TableSpec {
  name: string;
  title: string;
  description: string;
  category: Category;
  keywords: string;
  doc: string;
  rows: readonly object[];
  columns: Column[];
  output: VgiSchema;
  primaryKey: string[];
  unique?: string[][];
  examples: { sql: string; description: string; expected_result?: unknown[][] }[];
}

function catalogTable(spec: TableSpec): TableDescriptor {
  const tags = {
    ...objectTags({
      title: spec.title,
      category: spec.category,
      keywords: spec.keywords,
      docLlm: spec.doc,
      docMd: `## ${spec.title}\n\n${spec.doc}\n\n### Columns\n\n${docTable(spec.columns)}`,
    }),
    "vgi.result_columns_schema": resultColumnsTag(spec.columns),
    domain: "chemistry",
  };
  const scan = defineTableFunction<Record<string, never>, { done: boolean }>({
    name: `${spec.name}_scan`,
    description: spec.description,
    onBind: () => ({ outputSchema: spec.output }),
    cardinality: () => ({ estimate: BigInt(spec.rows.length), max: BigInt(spec.rows.length) }),
    initialState: () => ({ done: false }),
    process: (params, state, out) => {
      if (state.done) {
        out.finish();
        return;
      }
      state.done = true;
      out.emit(batchFromColumns(columnsOf(spec.rows, params.outputSchema), params.outputSchema));
    },
    tags,
  });
  const examples = spec.examples.map(({ sql, description }) => ({ sql, description }));
  const executable = spec.examples.filter((e) => e.expected_result);
  return {
    name: spec.name,
    comment: spec.description,
    columns: spec.output,
    function: scan,
    columnComments: Object.fromEntries(spec.columns.map(([n, , d]) => [n, d])),
    constraints: [
      ...spec.columns
        .filter(([, , , nullable]) => !nullable)
        .map(([name]) =>
          constraintRecord({
            schemaPath: ["main"],
            table: spec.name,
            id: `${name}_not_null`,
            kind: "NOT_NULL",
            columns: [[name]],
            enforcement: "ENFORCED",
            validation: "ALL_ROWS",
          }),
        ),
      constraintRecord({
        schemaPath: ["main"],
        table: spec.name,
        id: "primary_key",
        kind: "PRIMARY_KEY",
        columns: spec.primaryKey.map((c) => [c]),
        enforcement: "ENFORCED",
        validation: "ALL_ROWS",
      }),
      ...(spec.unique ?? []).map((cols) =>
        constraintRecord({
          schemaPath: ["main"],
          table: spec.name,
          id: `${cols.join("_")}_unique`,
          kind: "UNIQUE",
          columns: cols.map((c) => [c]),
          enforcement: "ENFORCED",
          validation: "ALL_ROWS",
        }),
      ),
    ],
    tags: {
      ...tags,
      "vgi.example_queries": JSON.stringify(examples),
      ...(executable.length ? { "vgi.executable_examples": JSON.stringify(executable) } : {}),
    },
  };
}

export const elementsTable = catalogTable({
  name: "elements",
  title: "Periodic Table",
  description:
    "All 118 chemical elements with atomic mass, position, electron configuration and physical properties; " +
    "bundled offline from PubChem and NIST.",
  category: "reference",
  keywords:
    "periodic table, chemical elements, atomic mass, atomic weight, electronegativity, electron configuration, " +
    "melting point, density, oxidation states, groups, periods",
  doc:
    "One row per element, Z = 1 (hydrogen) to 118 (oganesson), keyed by atomic_number; symbol is also unique. " +
    "atomic_mass is a `DOUBLE` in g/mol suitable for arithmetic; standard_atomic_weight keeps NIST's published " +
    "text with its uncertainty or interval. group_number, period and block are derived from Z (lanthanides " +
    "and actinides have NULL group). Physical properties (electronegativity, radius, ionization energy, " +
    "melting/boiling point in K, density in g/cm3, oxidation states, discovery year, CPK colour) come from " +
    "PubChem; superheavy-element values are often NULL or predicted (properties_predicted). Data is a fixed " +
    "bundled snapshot; no network is used.",
  rows: ELEMENTS,
  columns: ELEMENT_COLUMNS,
  output: ELEMENT_SCHEMA,
  primaryKey: ["atomic_number"],
  unique: [["symbol"], ["name"]],
  examples: [
    {
      sql:
        "SELECT symbol, name, atomic_mass FROM elements.main.elements " +
        "WHERE group_number = 18 ORDER BY atomic_number",
      description: "The noble gases with their atomic masses",
      expected_result: [
        ["He", "Helium", 4.002602],
        ["Ne", "Neon", 20.1797],
        ["Ar", "Argon", 39.948],
        ["Kr", "Krypton", 83.798],
        ["Xe", "Xenon", 131.293],
        ["Rn", "Radon", 222.0175782],
        ["Og", "Oganesson", 295.216],
      ],
    },
    {
      sql:
        "SELECT block, count(*) AS elements, round(avg(electronegativity_pauling), 2) AS avg_en " +
        "FROM elements.main.elements GROUP BY block ORDER BY block",
      description: "Element count and mean electronegativity per block",
    },
  ],
});

export const isotopesTable = catalogTable({
  name: "isotopes",
  title: "Isotope Table",
  description:
    "Every nuclide in NIST's Atomic Weights and Isotopic Compositions table (3,352 isotopes) with relative " +
    "atomic mass and natural abundance; bundled offline.",
  category: "reference",
  keywords:
    "isotopes, nuclides, isotopic composition, natural abundance, relative atomic mass, mass number, " +
    "deuterium, tritium, NIST",
  doc:
    "One row per nuclide, keyed by (atomic_number, mass_number); nuclide ('Fe-56') is also unique. " +
    "relative_atomic_mass is NIST's mass in u with its uncertainty; relative_atomic_mass_estimated marks " +
    "values NIST derives from systematic trends ('#'). isotopic_composition is the representative natural " +
    "mole fraction, NULL for isotopes with no natural abundance; summing it per element gives about 1. " +
    "NIST does not flag stability, so a NULL composition does not by itself mean an isotope is unstable. " +
    "Deuterium (D) and tritium (T) appear as H-2 and H-3. Join to elements on atomic_number.",
  rows: ISOTOPES,
  columns: ISOTOPE_COLUMNS,
  output: ISOTOPE_SCHEMA,
  primaryKey: ["atomic_number", "mass_number"],
  unique: [["nuclide"]],
  examples: [
    {
      sql:
        "SELECT nuclide, isotopic_composition FROM elements.main.isotopes " +
        "WHERE symbol = 'C' AND isotopic_composition IS NOT NULL ORDER BY mass_number",
      description: "Natural isotopes of carbon and their abundance",
      expected_result: [
        ["C-12", 0.9893],
        ["C-13", 0.0107],
      ],
    },
    {
      sql:
        "SELECT e.symbol, count(*) AS natural_isotopes FROM elements.main.isotopes i " +
        "JOIN elements.main.elements e USING (atomic_number) WHERE i.isotopic_composition IS NOT NULL " +
        "GROUP BY e.symbol ORDER BY natural_isotopes DESC, e.symbol LIMIT 3",
      description: "Elements with the most naturally occurring isotopes",
    },
  ],
});

export const TABLES = [elementsTable, isotopesTable];
