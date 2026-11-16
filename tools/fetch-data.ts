/**
 * Re-download the upstream files the bundle is built from (maintainers only).
 *
 *   bun run tools/fetch-data.ts && bun run tools/build-data.ts
 *
 * Two polite requests, one second apart, with a generic User-Agent. The worker
 * itself never touches the network. After a refresh, update the retrieval date
 * and SHA-256 checksums in DATA-SOURCES.md (this script prints them).
 */

const SOURCES = [
  {
    file: "data/raw/pubchem-periodictable.json",
    url: "https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON",
  },
  {
    file: "data/raw/nist-compositions-all.html",
    url: "https://physics.nist.gov/cgi-bin/Compositions/stand_alone.pl?ele=&all=all&ascii=ascii2&isotype=all",
  },
];

const USER_AGENT = "vgi-elements/0.1 (+https://query.farm)";

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  for (const [i, src] of SOURCES.entries()) {
    if (i > 0) await Bun.sleep(1000);
    const res = await fetch(src.url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${src.url}: HTTP ${res.status}`);
    const body = new Uint8Array(await res.arrayBuffer());
    await Bun.write(`${root}${src.file}`, body);
    const sha = new Bun.CryptoHasher("sha256").update(body).digest("hex");
    console.error(`${sha}  ${src.file}  (${body.length} bytes)`);
  }
}
