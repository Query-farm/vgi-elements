/**
 * Discovery metadata: the one file to edit when you rename or extend the worker.
 *
 * DuckDB, coding agents and the `vgi-lint` metadata checker all read these
 * tags. Keep every object documented and `make lint-explain` stays at 100.
 *
 * - Catalog-level tags (title, license, author, links, long description) live in
 *   `CATALOG_TAGS` below.
 * - Every function carries `objectTags(...)`: a title, a category from
 *   `SCHEMA_CATEGORIES`, search keywords, and LLM- and human-facing docs.
 */

import { field, type VgiDataType, type VgiField } from "@query-farm/vgi";

export const CATALOG_NAME = "elements";
export const VERSION = "0.1.0";

export const SOURCE_URL = "https://github.com/Query-farm/vgi-elements";

/**
 * Categories group functions in docs and agent tools. Every object's
 * `vgi.category` must name one of these.
 */
export const SCHEMA_CATEGORIES = [
  { name: "reference", title: "Reference tables", description: "Bundled periodic-table and isotope data." },
  { name: "lookup", title: "Element lookups", description: "Scalars that map symbols, names and numbers." },
  { name: "formulas", title: "Chemical formulas", description: "Molar mass and composition of formulas." },
] as const;

export type Category = (typeof SCHEMA_CATEGORIES)[number]["name"];

/** Turn `"a, b, c"` into the JSON array string `vgi.keywords` requires. */
export function keywordsArray(keywords: string): string {
  return JSON.stringify(
    keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

/** Build the standard per-object discovery tags. */
export function objectTags(opts: {
  title: string;
  category: Category;
  keywords: string;
  docLlm: string;
  docMd: string;
}): Record<string, string> {
  return {
    "vgi.title": opts.title,
    "vgi.category": opts.category,
    "vgi.keywords": keywordsArray(opts.keywords),
    "vgi.doc_llm": opts.docLlm,
    "vgi.doc_md": opts.docMd,
  };
}

/** Build an Arrow field whose `comment` shows up in DuckDB's `DESCRIBE` and agent tools. */
export function column(name: string, type: VgiDataType, comment: string, nullable = true): VgiField {
  return field(name, type, nullable, new Map([["comment", comment]]));
}

export const CATALOG_DOC_LLM =
  "Offline chemistry reference data for SQL: the periodic table of all 118 elements and NIST's table of 3,352 " +
  "isotopes, bundled in the worker (no network, no key, deterministic). Reach for it to look up element " +
  "properties (atomic mass, position in the table, category, electron configuration, electronegativity, " +
  "radius, ionization energy, oxidation states, melting and boiling points, density, discovery year), to " +
  "read nuclide masses and natural abundances, to convert between atomic numbers, symbols and names " +
  "(case-insensitive), and to compute molar masses and mass percentages of chemical formulas with groups " +
  "and hydrates. Element and isotope rows join on the atomic number. Lookup scalars return NULL for " +
  "unknown input instead of failing. Atomic masses are in g/mol: the NIST standard atomic weight, the " +
  "IUPAC conventional value for elements published as an interval (H 1.008, C 12.011, O 15.999), or the " +
  "longest-lived isotope's mass for radioactive elements.";

/** One plain paragraph shown as the worker's directory description (VGI107). */
export const CATALOG_COMMENT =
  "The periodic table and NIST isotope data as offline DuckDB tables, with element lookups and chemical " +
  "formula molar-mass and composition functions. No network or API key needed.";

export const CATALOG_DOC_MD =
  "# VGI Elements\n\n" +
  "Periodic-table and isotope reference data that runs entirely offline: every value is bundled in the " +
  "worker, so queries are deterministic and need no network or key.\n\n" +
  "## What you can do\n\n" +
  "- Look up element properties by atomic number, symbol or name, and normalize messy element columns.\n" +
  "- Compute molar masses of formulas such as `CuSO4·5H2O` or `K4[Fe(CN)6]`, and their mass percent.\n" +
  "- Explore isotopes and natural abundances, joined to the elements on `atomic_number`.\n\n" +
  "## Caveats\n\n" +
  "Atomic masses are in g/mol. For the twelve elements IUPAC publishes as an interval (H, Li, B, C, N, O, " +
  "Mg, Si, S, Cl, Br, Tl) the worker uses IUPAC's conventional single value; for radioactive elements " +
  "without a standard atomic weight it uses the longest-lived isotope's mass. Group, period and block are " +
  "derived from the atomic number. Superheavy-element properties are sparse or predicted. NIST's table is " +
  "the vintage published on its site and can lag the latest IUPAC revisions.\n\n" +
  "## Sources and references\n\n" +
  "- [PubChem Periodic Table](https://pubchem.ncbi.nlm.nih.gov/periodic-table/) (NCBI/NLM): element " +
  "properties.\n" +
  "- [NIST Atomic Weights and Isotopic Compositions](https://www.nist.gov/pml/atomic-weights-and-isotopic-" +
  "compositions-relative-atomic-masses): isotope masses, compositions and standard atomic weights.\n" +
  "- [IUPAC CIAAW](https://www.ciaaw.org/atomic-weights.htm): conventional atomic weights.";

export const SCHEMA_COMMENT =
  "Periodic table and isotope reference tables, element lookup scalars and chemical formula functions.";

export const SCHEMA_DOC_LLM =
  "The only schema of the elements worker. Start with the elements table (one row per element, key " +
  "atomic_number, unique symbol) or the isotopes table (key atomic_number + mass_number) and join them on " +
  "atomic_number. The lookup scalars accept a column and are vectorized; the numeric overloads take an " +
  "atomic number, the text overloads a symbol or English name in any case. Scalars have no named arguments. " +
  "Use formula_mass for one molar mass per row, and formula_composition(formula) for an element-by-element " +
  "breakdown of one constant formula.";

export const SCHEMA_DOC_MD =
  "## main\n\n" +
  "Everything the worker exposes lives here: two bundled reference tables, element lookups and formula " +
  "math.\n\n" +
  "Tables are read by name with no arguments and join on `atomic_number`. Scalars work on whole columns, " +
  "so they also clean up and join free-text element data.\n\n" +
  "All values are a fixed offline snapshot of PubChem and NIST data; see the catalog documentation for " +
  "how atomic masses are chosen.";

export const AGENT_TEST_TASKS = [
  { name: "iron_mass", prompt: "Using the elements worker, what is the atomic mass of iron?" },
  {
    name: "aspirin_mass",
    prompt: "Using the elements worker, compute the molar mass of aspirin, C9H8O4, rounded to 2 decimals.",
  },
  {
    name: "noble_gases",
    prompt: "List the symbols of the noble gases (group 18) in order of atomic number.",
  },
  {
    name: "oxygen_isotopes",
    prompt:
      "Which naturally occurring isotopes of oxygen exist? Give mass number and isotopic composition, by mass number.",
  },
  {
    name: "normalize_symbols",
    prompt:
      "Map the free-text element values 'fe', 'GOLD' and 'na' to their atomic numbers, symbols and English names, ordered by atomic number.",
  },
  {
    name: "hydrate_water_percent",
    prompt:
      "What percentage of the mass of copper(II) sulfate pentahydrate (CuSO4·5H2O) is hydrogen? Round to 2 decimals.",
  },
];

export const CATALOG_TAGS: Record<string, string> = {
  "vgi.title": "VGI Elements",
  "vgi.subtitle": "The periodic table, isotopes and chemical formula molar masses as offline DuckDB SQL.",
  "vgi.doc_llm": CATALOG_DOC_LLM,
  "vgi.doc_md": CATALOG_DOC_MD,
  "vgi.source_url": SOURCE_URL,
  "vgi.icon_url": "https://query.farm/media-kit/products/vgi/vgi-logo.png",
  "vgi.license": "0BSD",
  "vgi.author": "Query.Farm",
  "vgi.copyright": "Copyright 2026 Query.Farm LLC",
  "vgi.keywords": keywordsArray(
    "periodic table, chemical elements, isotopes, atomic mass, molar mass, chemical formula, chemistry, nist, pubchem",
  ),
  "vgi.support_contact": `${SOURCE_URL}/issues`,
  "vgi.support_policy_url": `${SOURCE_URL}#support`,
  "vgi.agent_test_tasks": JSON.stringify(AGENT_TEST_TASKS),
};

export const SCHEMA_TAGS: Record<string, string> = {
  "vgi.title": "Elements, Isotopes and Formulas",
  domain: "chemistry",
  "vgi.keywords": keywordsArray(
    "periodic table, element lookup, isotopes, formula mass, molecular weight, mass percent, stoichiometry",
  ),
  "vgi.doc_llm": SCHEMA_DOC_LLM,
  "vgi.doc_md": SCHEMA_DOC_MD,
  "vgi.categories": JSON.stringify(SCHEMA_CATEGORIES),
};
