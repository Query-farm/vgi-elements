// Unit tests. The SQL-level tests live in test/sql and run through DuckDB.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Arguments, VgiClient } from "@query-farm/vgi";
import { subprocessConnect } from "@query-farm/vgi-rpc";
import {
  byKey,
  byNumber,
  ELEMENTS,
  FormulaError,
  formulaComposition,
  formulaMass,
  ISOTOPES,
  parseFormula,
} from "../src/chem.ts";
import { blockOf, buildData, groupOf, parseUncertain, periodOf, toJsonLines } from "../tools/build-data.ts";

const ROOT = join(import.meta.dir, "..");

describe("bundled data", () => {
  test("118 elements, Z 1..118, unique symbols", () => {
    expect(ELEMENTS.length).toBe(118);
    expect(ELEMENTS.map((e) => e.atomic_number)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118);
    expect(byNumber(118)?.symbol).toBe("Og");
    expect(byNumber(118)?.name).toBe("Oganesson");
  });

  test("known atomic masses", () => {
    expect(byKey("Fe")?.atomic_mass).toBe(55.845);
    expect(byKey("H")?.atomic_mass).toBe(1.008);
    expect(byKey("C")?.atomic_mass).toBe(12.011);
    expect(byKey("O")?.atomic_mass).toBe(15.999);
    expect(byKey("Cu")?.atomic_mass).toBe(63.546);
    expect(byKey("C")?.atomic_mass_basis).toBe("conventional_atomic_weight");
    expect(byKey("C")?.standard_atomic_weight).toBe("[12.0096,12.0116]");
    expect(byKey("Tc")?.atomic_mass_basis).toBe("longest_lived_isotope");
    expect(byKey("Tc")?.standard_atomic_weight).toBe("[98]");
  });

  test("derived position", () => {
    expect([groupOf(1), groupOf(2), groupOf(26), groupOf(57), groupOf(72), groupOf(118)]).toEqual([
      1,
      18,
      8,
      null,
      4,
      18,
    ]);
    expect([periodOf(1), periodOf(3), periodOf(26), periodOf(118)]).toEqual([1, 2, 4, 7]);
    expect([blockOf(2), blockOf(5), blockOf(26), blockOf(92)]).toEqual(["s", "p", "d", "f"]);
    expect(ELEMENTS.filter((e) => e.group_number === 18).map((e) => e.symbol)).toEqual([
      "He",
      "Ne",
      "Ar",
      "Kr",
      "Xe",
      "Rn",
      "Og",
    ]);
    expect(ELEMENTS.filter((e) => e.group_number === null).length).toBe(30);
  });

  test("PubChem fields are typed and normalized", () => {
    const fe = byKey("iron");
    expect(fe?.oxidation_states).toEqual([3, 2]);
    expect(fe?.discovered_in_antiquity).toBe(true);
    expect(fe?.year_discovered).toBeNull();
    expect(byKey("H")?.oxidation_states).toEqual([1, -1]);
    expect(byKey("Nh")?.oxidation_states).toBeNull();
    const og = byKey("Og");
    expect(og?.standard_state).toBe("Gas");
    expect(og?.properties_predicted).toBe(true);
    expect(og?.electron_configuration).not.toContain("predicted");
    expect(byKey("N")?.electron_configuration).toBe("[He]2s2 2p3");
  });

  test("isotopes", () => {
    expect(ISOTOPES.length).toBe(3352);
    const fe56 = ISOTOPES.find((i) => i.nuclide === "Fe-56");
    expect(fe56?.isotopic_composition).toBe(0.91754);
    expect(fe56?.is_most_abundant).toBe(true);
    const c12 = ISOTOPES.find((i) => i.nuclide === "C-12");
    expect(c12?.relative_atomic_mass).toBe(12);
    expect(c12?.relative_atomic_mass_uncertainty).toBe(0); // exact by definition: NIST "12.0000000(00)"
    // NIST labels these D, T, Uup and Uus; the bundle uses the element symbol.
    expect(ISOTOPES.find((i) => i.nuclide === "H-2")?.symbol).toBe("H");
    expect(ISOTOPES.filter((i) => i.atomic_number === 115).every((i) => i.symbol === "Mc")).toBe(true);
    expect(new Set(ISOTOPES.map((i) => i.nuclide)).size).toBe(ISOTOPES.length);
    // Natural compositions sum to ~1 per element.
    const sums = new Map<number, number>();
    for (const i of ISOTOPES)
      sums.set(i.atomic_number, (sums.get(i.atomic_number) ?? 0) + (i.isotopic_composition ?? 0));
    for (const s of sums.values()) if (s > 0) expect(Math.abs(s - 1)).toBeLessThan(0.002);
  });

  test("committed JSON is what tools/build-data.ts produces from data/raw", async () => {
    const pub = await Bun.file(join(ROOT, "data/raw/pubchem-periodictable.json")).text();
    const nist = await Bun.file(join(ROOT, "data/raw/nist-compositions-all.html")).text();
    const { elements, isotopes } = buildData(pub, nist);
    expect(toJsonLines(elements)).toBe(await Bun.file(join(ROOT, "src/data/elements.json")).text());
    expect(toJsonLines(isotopes)).toBe(await Bun.file(join(ROOT, "src/data/isotopes.json")).text());
  });

  test("parseUncertain", () => {
    expect(parseUncertain("55.845(2)")).toEqual({ value: 55.845, uncertainty: 0.002, estimated: false });
    expect(parseUncertain("45.01442(43#)")).toEqual({ value: 45.01442, uncertainty: 0.00043, estimated: true });
    expect(parseUncertain("12.0000000")).toEqual({ value: 12, uncertainty: null, estimated: false });
    expect(parseUncertain("&nbsp;")).toBeNull();
  });
});

describe("lookups", () => {
  test("case-insensitive symbol and name, with spelling variants", () => {
    for (const k of ["Fe", "fe", "FE", " iron ", "Iron"]) expect(byKey(k)?.atomic_number).toBe(26);
    expect(byKey("aluminium")?.symbol).toBe("Al");
    expect(byKey("caesium")?.symbol).toBe("Cs");
    expect(byKey("sulphur")?.symbol).toBe("S");
    expect(byKey("Xx")).toBeUndefined();
    expect(byNumber(0)).toBeUndefined();
    expect(byNumber(119n)).toBeUndefined();
  });
});

describe("formulas", () => {
  const close = (a: number, b: number, tol = 0.001) => expect(Math.abs(a - b)).toBeLessThan(tol);

  test("known molar masses", () => {
    close(formulaMass("H2O"), 18.015);
    close(formulaMass("C9H8O4"), 180.159);
    close(formulaMass("NaCl"), 58.44, 0.001);
    close(formulaMass("Ca(OH)2"), 74.092);
    close(formulaMass("K4[Fe(CN)6]"), 368.35, 0.01);
    close(formulaMass("Fe"), 55.845);
  });

  test("hydrates and coefficients", () => {
    const expected = 63.546 + 32.06 + 4 * 15.999 + 5 * 18.015;
    for (const f of ["CuSO4·5H2O", "CuSO4*5H2O", "CuSO4.5H2O", "CuSO4 • 5 H2O"]) close(formulaMass(f), expected);
    close(formulaMass("2H2O"), 2 * 18.015);
    expect(Object.fromEntries(parseFormula("CuSO4·5H2O"))).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
  });

  test("nesting and case sensitivity", () => {
    expect(Object.fromEntries(parseFormula("Al2(SO4)3"))).toEqual({ Al: 2, S: 3, O: 12 });
    expect(Object.fromEntries(parseFormula("{[(CH3)2]2}3"))).toEqual({ C: 12, H: 36 });
    expect(Object.fromEntries(parseFormula("Co"))).toEqual({ Co: 1 });
    expect(Object.fromEntries(parseFormula("CO"))).toEqual({ C: 1, O: 1 });
  });

  test("invalid formulas throw FormulaError", () => {
    for (const f of ["", "h2o", "Xx2", "H2O)", "(H2O", "H0", "H2O·", "Fe0.95O", "H2O+", "()"]) {
      expect(() => parseFormula(f)).toThrow(FormulaError);
    }
    expect(() => parseFormula("CuSO4·5Hx2O")).toThrow(/unknown element symbol 'Hx'/);
  });

  test("composition sums to the formula mass", () => {
    const rows = formulaComposition("C9H8O4");
    expect(rows.map((r) => [r.element, r.count])).toEqual([
      ["C", 9n],
      ["H", 8n],
      ["O", 4n],
    ]);
    close(
      rows.reduce((s, r) => s + r.mass_fraction, 0),
      1,
      1e-12,
    );
    close(
      rows.reduce((s, r) => s + r.mass, 0),
      formulaMass("C9H8O4"),
      1e-9,
    );
  });
});

describe("against the worker", () => {
  let client: VgiClient;

  beforeAll(() => {
    // A client that launches the worker as a subprocess, the way DuckDB does.
    client = new VgiClient(subprocessConnect([process.execPath, "run", join(ROOT, "src", "worker.ts")]));
  });

  afterAll(() => {
    client?.close();
  });

  async function table(name: string, positional: unknown[]) {
    const rows: Record<string, unknown>[] = [];
    for await (const page of client.tableFunctionRows({
      functionName: name,
      arguments: new Arguments(positional, new Map()),
      int64: "bigint",
    })) {
      rows.push(...page);
    }
    return rows;
  }

  test("formula_composition: rows for a hydrate", async () => {
    const rows = await table("formula_composition", ["CuSO4·5H2O"]);
    expect(rows.map((r) => [r.element, Number(r.count)])).toEqual([
      ["Cu", 1],
      ["S", 1],
      ["O", 9],
      ["H", 10],
    ]);
  });

  test("formula_composition: invalid formula is an error naming the position", async () => {
    await expect(table("formula_composition", ["H2Q"])).rejects.toThrow(/unknown element symbol 'Q'/);
  });
});
