# Pinned CIEL lookup

CIEL v2026-09-24, created by the Columbia International eHealth Laboratory
(CIEL), Columbia University, and distributed by [Open Concept Lab](https://openconceptlab.org/).
CIEL content is credited under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
External terminology codes retain their respective owners' rights.

[`mapping.md`](mapping.md) is the dated record of the CIEL mapping trial; its paths refer to the repository at commit `fd5bce7`.

`ciel-v2026-09-24.jsonl.gz` is the compact, modified representation produced by
[`index.py`](index.py), compressed with gzip level 9
and timestamp zero. Each of its 58,870 records retains the id, class, datatype,
retired status, preferred names, up to 12 English names, and active outgoing
CIEL mappings. It omits descriptions, units, ranges and export administrative
fields. It supports vocabulary lookup; it is not a dose reference.

The full archive SHA256, compact and uncompressed SHA256 values, version,
source link and credit are in `manifest.json`. The supplied archive is
`orgs_CIEL_sources_CIEL_v2026-09-24_2026-09-24_030336.zip`, SHA256
`6e6e6622c03035da0e4478485a5f13fd725e75ef96d06282be648620f7a762f6`.
The archive and full export stay outside git.

The generator preserves one identical duplicate record from the export, CIEL
149996 (Acquired spondylolysis): 58,870 records represent 58,869 unique ids.
Tests require that duplicate to remain identical and reject conflicting copies.

To rebuild, verify that archive hash, extract its sole `export.json` member to
a scratch directory outside the repository, then run from the repository root:

```sh
python3 -I core/vocabulary/ciel/index.py /tmp/ciel/export.json /tmp/ciel/ciel-v2026-09-24.jsonl
python3 - <<'PY'
import gzip, pathlib
raw = pathlib.Path('/tmp/ciel/ciel-v2026-09-24.jsonl').read_bytes()
pathlib.Path('core/vocabulary/ciel/ciel-v2026-09-24.jsonl.gz').write_bytes(
    gzip.compress(raw, compresslevel=9, mtime=0))
PY
bun test ./core/vocabulary/ciel.test.ts
```

To use the existing trial search, decompress to scratch with
`gzip -dc core/vocabulary/ciel/ciel-v2026-09-24.jsonl.gz > /tmp/ciel.jsonl`,
then run `python3 -I core/vocabulary/ciel/search.py /tmp/ciel.jsonl phenobarbital`.
The tests verify both lookup hashes and that every registry mapping resolves to
an active concept in this release.
