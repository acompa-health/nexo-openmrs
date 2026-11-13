# Search the compact CIEL index by words or by id.
# Usage: python3 -I search.py <index.jsonl> <words...> | --id <id>
import json, sys, re
path, args = sys.argv[1], sys.argv[2:]
rows = [json.loads(l) for l in open(path, encoding='utf-8')]
def show(c, score=None):
    maps = '; '.join(f'{t} {s} {k}' for t, s, k in c['maps'] if s in ('LOINC', 'SNOMED-CT', 'ICD-11-WHO', 'ICD-10-WHO') and t in ('SAME-AS', 'NARROWER-THAN', 'BROADER-THAN'))[:200]
    print(f"{c['id']}\t{c['class']}\t{c['datatype']}\t{c['names'].get('en')}\t| {', '.join(c['en'][:4])}\t| {maps}")
if args[:1] == ['--id']:
    for c in rows:
        if c['id'] in args[1:]: show(c)
    sys.exit()
words = [w.lower() for w in args]
hits = []
for c in rows:
    if c['retired']: continue
    text = ' '.join([c['names'].get('en') or ''] + c['en']).lower()
    if all(re.search(r'\b' + re.escape(w), text) for w in words):
        fsn = (c['names'].get('en') or '').lower()
        hits.append((0 if all(w in fsn for w in words) else 1, len(fsn), c))
for _, _, c in sorted(hits, key=lambda h: (h[0], h[1]))[:15]: show(c)
