/**
 * Build the bundled element and isotope data from the committed upstream files.
 *
 *   bun run tools/build-data.ts            # data/raw/* -> src/data/*.json
 *
 * Inputs (fetched once by tools/fetch-data.ts, committed under data/raw/):
 * - data/raw/pubchem-periodictable.json  PubChem PUG REST periodic table
 * - data/raw/nist-compositions-all.html  NIST Atomic Weights and Isotopic Compositions,
 *                                        all elements, linearized ASCII output
 *
 * `buildData` is pure (strings in, rows out) so the unit tests can rebuild the
 * bundle from the raw files and check that the committed JSON is current.
 */

export interface ElementRow {
  atomic_number: number;
  symbol: string;
  name: string;
  atomic_mass: number;
  atomic_mass_basis: "standard_atomic_weight" | "conventional_atomic_weight" | "longest_lived_isotope";
  standard_atomic_weight: string | null;
  atomic_weight_notes: string[];
  group_number: number | null;
  period: number;
  block: "s" | "p" | "d" | "f";
  group_block: string;
  electron_configuration: string;
  electronegativity_pauling: number | null;
  atomic_radius_pm: number | null;
  ionization_energy_ev: number | null;
  electron_affinity_ev: number | null;
  oxidation_states: number[] | null;
  standard_state: string;
  properties_predicted: boolean;
  melting_point_k: number | null;
  boiling_point_k: number | null;
  density: number | null;
  year_discovered: number | null;
  discovered_in_antiquity: boolean;
  cpk_hex_color: string | null;
}

export interface IsotopeRow {
  atomic_number: number;
  symbol: string;
  mass_number: number;
  nuclide: string;
  relative_atomic_mass: number;
  relative_atomic_mass_uncertainty: number | null;
  relative_atomic_mass_estimated: boolean;
  isotopic_composition: number | null;
  isotopic_composition_uncertainty: number | null;
  is_most_abundant: boolean;
}

/**
 * IUPAC CIAAW conventional atomic weights for the elements whose standard
 * atomic weight is published as an interval [a, b]. These are the single values
 * IUPAC recommends "for trade and commerce" (abridged/conventional table).
 */
export const CONVENTIONAL_ATOMIC_WEIGHTS: Record<string, number> = {
  H: 1.008,
  Li: 6.94,
  B: 10.81,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  Mg: 24.305,
  Si: 28.085,
  S: 32.06,
  Cl: 35.45,
  Br: 79.904,
  Tl: 204.38,
};

const PERIOD_ENDS = [2, 10, 18, 36, 54, 86, 118];

/** Period (row) of an element, from its atomic number. */
export function periodOf(z: number): number {
  const p = PERIOD_ENDS.findIndex((end) => z <= end);
  if (p < 0 || z < 1) throw new Error(`atomic number out of range: ${z}`);
  return p + 1;
}

/** IUPAC 1-18 group; NULL for the lanthanides (57-71) and actinides (89-103). */
export function groupOf(z: number): number | null {
  if ((z >= 57 && z <= 71) || (z >= 89 && z <= 103)) return null;
  const period = periodOf(z);
  const start = period === 1 ? 1 : (PERIOD_ENDS[period - 2] ?? 0) + 1;
  const pos = z - start + 1;
  if (period === 1) return z === 1 ? 1 : 18;
  if (period <= 3) return pos <= 2 ? pos : pos + 10;
  if (period <= 5) return pos;
  return pos <= 2 ? pos : pos - 14;
}

/** Block, following the same 15-wide lanthanide/actinide rows used for group. */
export function blockOf(z: number): ElementRow["block"] {
  const g = groupOf(z);
  if (g === null) return "f";
  if (g <= 2 || z === 2) return "s";
  if (g <= 12) return "d";
  return "p";
}

function num(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const v = Number(t);
  if (!Number.isFinite(v)) throw new Error(`not a number: ${JSON.stringify(s)}`);
  return v;
}

/** Parse NIST "45.01442(43#)" → value, uncertainty (in the last digits), estimated flag. */
export function parseUncertain(text: string): { value: number; uncertainty: number | null; estimated: boolean } | null {
  const t = text.replace(/&nbsp;/g, "").trim();
  if (t === "") return null;
  const m = /^(\d+)(?:\.(\d+))?(?:\((\d+)(#?)\))?(#?)$/.exec(t);
  if (!m) throw new Error(`unparsed NIST value: ${JSON.stringify(text)}`);
  const [, int = "", frac = "", unc, hash1, hash2] = m;
  const value = Number(frac ? `${int}.${frac}` : int);
  const uncertainty = unc === undefined ? null : Number(unc) / 10 ** frac.length;
  return { value, uncertainty, estimated: hash1 === "#" || hash2 === "#" };
}

interface PubChemRow {
  [k: string]: string;
}

function parsePubChem(text: string): PubChemRow[] {
  const doc = JSON.parse(text) as { Table: { Columns: { Column: string[] }; Row: { Cell: string[] }[] } };
  const cols = doc.Table.Columns.Column;
  return doc.Table.Row.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r.Cell[i] ?? "").trim()])));
}

interface NistRecord {
  z: number;
  symbol: string;
  a: number;
  mass: string;
  composition: string;
  standard: string;
  notes: string;
}

function parseNist(text: string): NistRecord[] {
  const pre = /<pre>([\s\S]*?)<\/pre>/i.exec(text)?.[1];
  if (!pre) throw new Error("NIST file has no <pre> block");
  const out: NistRecord[] = [];
  for (const block of pre.split(/\n\s*\n/)) {
    const kv = new Map<string, string>();
    for (const line of block.split("\n")) {
      const i = line.indexOf(" = ");
      if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 3).trim());
      else if (line.trim().endsWith(" =")) kv.set(line.trim().slice(0, -2).trim(), "");
    }
    if (!kv.has("Atomic Number")) continue;
    out.push({
      z: Number(kv.get("Atomic Number")),
      symbol: kv.get("Atomic Symbol") ?? "",
      a: Number(kv.get("Mass Number")),
      mass: kv.get("Relative Atomic Mass") ?? "",
      composition: kv.get("Isotopic Composition") ?? "",
      standard: (kv.get("Standard Atomic Weight") ?? "").replace(/&nbsp;/g, "").trim(),
      notes: (kv.get("Notes") ?? "").replace(/&nbsp;/g, "").trim(),
    });
  }
  return out;
}

function parseOxidationStates(s: string): number[] | null {
  const t = s.trim();
  if (t === "") return null;
  return t.split(",").map((p) => {
    const v = Number(p.trim().replace(/^\+/, ""));
    if (!Number.isInteger(v)) throw new Error(`bad oxidation state ${JSON.stringify(s)}`);
    return v;
  });
}

export function buildData(pubchemText: string, nistText: string): { elements: ElementRow[]; isotopes: IsotopeRow[] } {
  const pub = parsePubChem(pubchemText);
  const nist = parseNist(nistText);
  if (pub.length !== 118) throw new Error(`expected 118 PubChem elements, got ${pub.length}`);
  const symbolOf = new Map(pub.map((r) => [Number(r.AtomicNumber), r.Symbol ?? ""]));

  const isotopes: IsotopeRow[] = nist.map((r) => {
    const symbol = symbolOf.get(r.z);
    if (!symbol) throw new Error(`NIST atomic number ${r.z} not in PubChem`);
    const mass = parseUncertain(r.mass);
    if (!mass) throw new Error(`NIST ${symbol}-${r.a} has no relative atomic mass`);
    const comp = parseUncertain(r.composition);
    return {
      atomic_number: r.z,
      symbol,
      mass_number: r.a,
      nuclide: `${symbol}-${r.a}`,
      relative_atomic_mass: mass.value,
      relative_atomic_mass_uncertainty: mass.uncertainty,
      relative_atomic_mass_estimated: mass.estimated,
      isotopic_composition: comp?.value ?? null,
      isotopic_composition_uncertainty: comp?.uncertainty ?? null,
      is_most_abundant: false,
    };
  });
  const seen = new Set<string>();
  for (const iso of isotopes) {
    if (seen.has(iso.nuclide)) throw new Error(`duplicate nuclide ${iso.nuclide}`);
    seen.add(iso.nuclide);
  }
  const byZ = new Map<number, IsotopeRow[]>();
  for (const iso of isotopes) byZ.set(iso.atomic_number, [...(byZ.get(iso.atomic_number) ?? []), iso]);
  for (const list of byZ.values()) {
    let best: IsotopeRow | undefined;
    for (const iso of list) {
      if (iso.isotopic_composition !== null && (!best || iso.isotopic_composition > (best.isotopic_composition ?? 0)))
        best = iso;
    }
    if (best) best.is_most_abundant = true;
  }

  const elements: ElementRow[] = pub.map((r) => {
    const z = Number(r.AtomicNumber);
    const symbol = r.Symbol ?? "";
    const recs = nist.filter((n) => n.z === z);
    const standard = recs[0]?.standard || null;
    const notes = recs[0]?.notes ? recs[0].notes.split(",").map((n) => n.trim()) : [];
    let atomicMass: number;
    let basis: ElementRow["atomic_mass_basis"];
    const single = standard && !standard.includes(",") ? parseUncertain(standard.replace(/^\[|\]$/g, "")) : null;
    if (standard && /^\[[\d.]+,[\d.]+\]$/.test(standard)) {
      const conv = CONVENTIONAL_ATOMIC_WEIGHTS[symbol];
      if (conv === undefined) throw new Error(`no conventional atomic weight for interval element ${symbol}`);
      atomicMass = conv;
      basis = "conventional_atomic_weight";
    } else if (standard && /^\[\d+\]$/.test(standard) && single) {
      const iso = byZ.get(z)?.find((i) => i.mass_number === single.value);
      if (!iso) throw new Error(`${symbol}: no isotope with mass number ${single.value}`);
      atomicMass = iso.relative_atomic_mass;
      basis = "longest_lived_isotope";
    } else if (single) {
      atomicMass = single.value;
      basis = "standard_atomic_weight";
    } else {
      const v = num(r.AtomicWeight);
      if (v === null) throw new Error(`${symbol}: no atomic weight`);
      atomicMass = v;
      basis = "longest_lived_isotope";
    }
    const rawState = r.StandardState ?? "";
    const rawConfig = r.ElectronConfiguration ?? "";
    const predicted = /expected|predicted|calculated/i.test(rawState + rawConfig);
    const year = (r.YearDiscovered ?? "").trim();
    return {
      atomic_number: z,
      symbol,
      name: r.Name ?? "",
      atomic_mass: atomicMass,
      atomic_mass_basis: basis,
      standard_atomic_weight: standard,
      atomic_weight_notes: notes,
      group_number: groupOf(z),
      period: periodOf(z),
      block: blockOf(z),
      group_block: r.GroupBlock ?? "",
      electron_configuration: rawConfig
        .replace(/\s*\((predicted|calculated)\)\s*$/i, "")
        .replace(/\]\s+/, "]")
        .trim(),
      electronegativity_pauling: num(r.Electronegativity),
      atomic_radius_pm: num(r.AtomicRadius),
      ionization_energy_ev: num(r.IonizationEnergy),
      electron_affinity_ev: num(r.ElectronAffinity),
      oxidation_states: parseOxidationStates(r.OxidationStates ?? ""),
      standard_state: rawState.replace(/^Expected to be an? /i, ""),
      properties_predicted: predicted,
      melting_point_k: num(r.MeltingPoint),
      boiling_point_k: num(r.BoilingPoint),
      density: num(r.Density),
      year_discovered: year === "Ancient" || year === "" ? null : Number(year),
      discovered_in_antiquity: year === "Ancient",
      cpk_hex_color: r.CPKHexColor ? r.CPKHexColor.toUpperCase() : null,
    };
  });
  for (const e of elements) {
    if (!(byZ.get(e.atomic_number)?.length ?? 0)) throw new Error(`${e.symbol}: no NIST isotopes`);
    if (e.year_discovered !== null && !Number.isInteger(e.year_discovered))
      throw new Error(`${e.symbol}: bad year ${e.year_discovered}`);
  }
  return { elements, isotopes };
}

/** One JSON row per line: small diffs when upstream data changes. */
export function toJsonLines(rows: unknown[]): string {
  return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const pubchem = await Bun.file(`${root}data/raw/pubchem-periodictable.json`).text();
  const nistText = await Bun.file(`${root}data/raw/nist-compositions-all.html`).text();
  const { elements, isotopes } = buildData(pubchem, nistText);
  await Bun.write(`${root}src/data/elements.json`, toJsonLines(elements));
  await Bun.write(`${root}src/data/isotopes.json`, toJsonLines(isotopes));
  console.error(`wrote ${elements.length} elements, ${isotopes.length} isotopes`);
}
