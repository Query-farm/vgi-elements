<p align="center">
  <img src="https://query.farm/media-kit/products/vgi/vgi-logo.png" alt="Vector Gateway Interface (VGI)" width="320">
</p>

<p align="center"><em>A Query.Farm VGI worker for DuckDB.</em></p>

# Query the Periodic Table, Isotopes and Chemical Formula Masses in DuckDB

> **vgi-elements** · a [Query.Farm](https://query.farm) VGI worker · written in TypeScript

[![CI](https://github.com/Query-farm/vgi-elements/actions/workflows/ci.yml/badge.svg)](https://github.com/Query-farm/vgi-elements/actions/workflows/ci.yml)
[![vgi worker: query.farm](https://query.farm/media-kit/shields/vgi-worker.svg)](https://query.farm)

All 118 chemical elements and NIST's 3,352 isotopes as SQL tables, plus element lookups and a
chemical-formula parser that computes molar masses and mass percentages. Everything is bundled
in the worker: no network, no API key, and the same answer every time.

```sql
SELECT f, round(elements.main.formula_mass(f), 3) AS g_per_mol
FROM (VALUES ('H2O'), ('C9H8O4'), ('CuSO4·5H2O')) t(f);
-- H2O 18.015 · C9H8O4 180.159 · CuSO4·5H2O 249.677
```

| SQL interface | Kind | Returns |
|---|---|---|
| `elements.main.elements` | table | 118 rows: atomic mass, group/period/block, category, electron configuration, electronegativity, radius, ionization energy, electron affinity, oxidation states (`INTEGER[]`), state, melting/boiling point, density, discovery year, CPK colour |
| `elements.main.isotopes` | table | 3,352 nuclides: mass number, relative atomic mass and uncertainty, natural isotopic composition |
| `element_symbol(atomic_number)` | scalar | `'Fe'` for 26 |
| `element_name(atomic_number)` / `element_name(symbol_or_name)` | scalar | `'Iron'` |
| `atomic_mass(atomic_number)` / `atomic_mass(symbol_or_name)` | scalar | `55.845` (g/mol) |
| `atomic_number(symbol_or_name)` | scalar | `26` for `'Fe'`, `'fe'` or `'Iron'` |
| `formula_mass(formula)` | scalar | molar mass in g/mol |
| `formula_composition(formula)` | table function | one row per element: `element`, `atomic_number`, `count`, `atomic_mass`, `mass`, `mass_fraction` |

The two tables join on `atomic_number`. Text lookups are case-insensitive and accept
`aluminium`/`aluminum`, `caesium`/`cesium` and `sulphur`/`sulfur`.

## Quick start

DuckDB 2.0 can run a released worker directly from GitHub:

```sql
SET allow_extension_repositories = 'allowed';
CREATE EXTENSION REPOSITORY IF NOT EXISTS query_farm
  WITH PREFIX 'https://duckdb-extensions.query.farm';
INSTALL vgi FROM query_farm;
LOAD vgi FROM query_farm;

ATTACH 'elements' (TYPE vgi, LOCATION 'github-auto://Query-farm/vgi-elements@v0.2.0');

SELECT symbol, name, atomic_mass
FROM elements.main.elements
WHERE group_number = 18
ORDER BY atomic_number;
```

From a checkout ([Bun](https://bun.sh) 1.3+):

```sh
git clone https://github.com/Query-farm/vgi-elements.git && cd vgi-elements
bun install --frozen-lockfile
```

```sql
ATTACH 'elements' (TYPE vgi, LOCATION '/abs/path/to/vgi-elements/bin/vgi-elements-worker');
```

**Haybarn 2.0.1+** (`uvx haybarn-cli`; Haybarn 2.0.0 serves an older vgi extension that cannot attach this worker): `INSTALL vgi FROM community; LOAD vgi;` then the same `ATTACH`.

Use an absolute path: `LOCATION` is the command DuckDB runs, resolved against its working
directory.

## Examples

```sql
-- Mass percent of each element in aspirin
SELECT element, count, round(100 * mass_fraction, 2) AS mass_percent
FROM elements.main.formula_composition('C9H8O4')
ORDER BY mass_percent DESC;

-- Normalize a messy element column and join it to the periodic table
SELECT s.raw, e.symbol, e.group_block
FROM (VALUES ('fe'), ('Gold'), ('NA'), ('unobtainium')) s(raw)
LEFT JOIN elements.main.elements e ON e.atomic_number = elements.main.atomic_number(s.raw);

-- Natural isotopes of oxygen
SELECT nuclide, isotopic_composition
FROM elements.main.isotopes
WHERE symbol = 'O' AND isotopic_composition IS NOT NULL
ORDER BY mass_number;

-- Molar masses of a column of formulas; invalid ones are NULL
SELECT formula, elements.main.formula_mass(formula) AS g_per_mol FROM my_compounds;
```

## Behaviour and conventions

**Atomic mass.** `atomic_mass` is a `DOUBLE` in g/mol. `atomic_mass_basis` says where each
value comes from:

- `standard_atomic_weight`: NIST's standard atomic weight (Fe `55.845(2)` → 55.845).
- `conventional_atomic_weight`: the twelve elements IUPAC publishes as an interval (H, Li, B,
  C, N, O, Mg, Si, S, Cl, Br, Tl) use IUPAC's conventional single value (H 1.008, C 12.011,
  O 15.999, ...). The interval itself stays in `standard_atomic_weight`.
- `longest_lived_isotope`: radioactive elements use the relative atomic mass of the isotope
  NIST names in brackets (Tc `[98]` → 97.9072124), or PubChem's value where NIST assigns no
  standard atomic weight (Am onward).

`standard_atomic_weight` keeps NIST's published text: `55.845(2)`, `[12.0096,12.0116]`, `[98]`,
or NULL.

**Derived columns.** `group_number`, `period` and `block` are computed from the atomic number
using the 18-column IUPAC layout. The lanthanides (La-Lu) and actinides (Ac-Lr) have a NULL
`group_number` and block `f`.

**Formulas.** Symbols are case-sensitive (`Co` is cobalt, `CO` is carbon monoxide). The parser
accepts integer subscripts, nested `()`, `[]` and `{}` groups, a leading coefficient (`2H2O`)
and hydrate parts joined by `·`, `•`, `*` or `.` (`CuSO4·5H2O`, `CuSO4*5H2O`). Whitespace is
ignored. Charges, isotope labels (`D2O`, `13C`) and fractional subscripts are not supported.

**Errors and NULLs.** Every scalar is NULL-in/NULL-out and returns **NULL** for an unknown
element, an atomic number outside 1-118 or an invalid formula, so one bad row does not fail
a whole query. `formula_composition` raises an **error** that names the problem and its
position (`invalid formula "H2Q": unknown element symbol 'Q' at position 3`), so use it to find
out why a formula was rejected.

**Pushdown.** The tables are small and in memory (118 and 3,352 rows), so each scan returns
the full table in one batch; DuckDB applies `WHERE` filters and the SDK applies projection
pushdown. No filter is pushed to an upstream service because there is none at query time.

**Browser-ready.** Runtime code has no native modules, no file reads and no network: the data
is imported as JSON modules (`src/data/*.json`), so the worker can be bundled for
[Haybarn WASM](https://query.farm/products/haybarn).

## Data sources and terms

The bundled data is built from two US-government public sources and IUPAC conventional values.
[DATA-SOURCES.md](DATA-SOURCES.md) lists URLs, retrieval dates, checksums and licence notes.

- [PubChem Periodic Table](https://pubchem.ncbi.nlm.nih.gov/periodic-table/) (NCBI, US National
  Library of Medicine): element properties.
- [NIST Atomic Weights and Isotopic Compositions](https://www.nist.gov/pml/atomic-weights-and-isotopic-compositions-relative-atomic-masses)
  (NIST Physical Measurement Laboratory): isotopes, compositions and standard atomic weights.
- [IUPAC CIAAW](https://www.ciaaw.org/atomic-weights.htm): conventional atomic weights.

These are factual reference values; upstream terms apply to the data separately from this
worker's code licence. NIST's table is the edition currently on its site and can lag the latest
IUPAC revisions (for example Ar, Pb and Yb).

To refresh the bundle (maintainers): `make data` re-downloads the two files and rebuilds
`src/data/*.json`; the unit tests fail if the committed JSON does not match a rebuild of
`data/raw/`.

## Development

```bash
make test-unit                 # bun unit tests (offline)
make test-sql                  # test/sql/*.test through DuckDB (stdio; TRANSPORT=launch|http)
make lint-explain              # vgi-lint metadata check, examples executed
make check                     # everything CI runs
```

[AGENTS.md](AGENTS.md) describes the layout, the recipe for adding a function and the sharp
edges.

## Releasing

Push a tag like `v0.1.0`. The release workflow compiles the worker with `bun build --compile`
into standalone executables for Linux (x86-64, arm64), macOS (arm64) and Windows (x86-64),
signed with cosign and carrying SLSA build provenance. `ci/check-version.sh` makes sure the tag
matches the version in `package.json`.

## Support

Open an issue on [this repository](https://github.com/Query-farm/vgi-elements/issues). For VGI
itself, see [query.farm](https://query.farm).

## Authorship & License

Written by [Query.Farm](https://query.farm). Released under the
[BSD Zero Clause License](LICENSE) (0BSD).

Copyright 2026 Query Farm LLC - https://query.farm
