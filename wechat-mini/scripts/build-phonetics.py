"""Build a small offline pronunciation subset from attributed ECDICT and US IPA data."""
from pathlib import Path
import csv
import hashlib
import json
import re
import shutil
import sys

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[1]
source = root / 'outputs/phonetics-source'
text = (root / 'miniprogram/data/vocabulary.js').read_text(encoding='utf-8')
vocabulary = json.loads(text[len('module.exports='):].strip().removesuffix(';'))
terms = {word['english'].split(',')[0].strip().lower() for word in vocabulary['words'] if not re.search(r'\s', word['english'].split(',')[0].strip())}
tokens = lambda value: re.findall(r"[a-z]+(?:'[a-z]+)?", value.lower())
needed = terms | {token for term in terms for token in tokens(term)} | set('abcdefghijklmnopqrstuvwxyz') | {'somebody', 'something', 'somebody\'s'}
british = {}
with (source / 'ecdict.csv').open(encoding='utf-8-sig', newline='') as file:
    for row in csv.DictReader(file):
        word, ipa = row['word'].strip().lower(), row.get('phonetic', '').strip()
        if word in needed and ipa:
            british[word] = ipa
american = {}
for line in (source / 'en_US.txt').read_text(encoding='utf-8').splitlines():
    if '\t' in line:
        word, ipa = line.split('\t', 1)
        if word.lower() in needed:
            american[word.lower()] = ipa
overrides = json.loads((root / 'scripts/phonetic-overrides.json').read_text(encoding='utf-8'))

def normalize(ipa):
    ipa = ipa.strip(' /[]').replace('ә:', 'ɜː').replace('ә', 'ə').replace(':', 'ː').replace("'", 'ˈ')
    if ipa.startswith('.'):
        ipa = 'ˌ' + ipa[1:]
    return ipa.replace('/, /', ' / ')

def lookup(word):
    if word in overrides:
        return {'ipa': overrides[word]['ipa'], 'label': overrides[word]['label']}
    if word in british:
        return {'ipa': normalize(british[word]), 'label': ''}
    if word in american:
        return {'ipa': normalize(american[word]), 'label': '美'}
    return None

data = {}
missing = []
for term in sorted(terms):
    entry = lookup(term)
    if term in {'b.c.e', 'cv', 'dj', 'dna', 'gdp', 'gps', 'ttfn'}:
        letters = [lookup(char) for char in term if char.isalpha()]
        if all(letters):
            entry = {'ipa': ' '.join(item['ipa'] for item in letters), 'label': '字母'}
    if not entry and (' ' in term or '-' in term):
        parts = tokens(term)
        # Placeholders are read in their expanded form; no unsupported connected-speech claim.
        aliases = {'sb': 'somebody', 'sth': 'something', "sb's": "somebody's"}
        entries = [lookup(aliases.get(part, part)) for part in parts]
        if parts and all(entries):
            entry = {'ipa': ' · '.join(item['ipa'].split(' / ')[0] for item in entries), 'label': '逐词'}
    if entry:
        data[term] = entry
    else:
        missing.append(term)

payload = {'entries': data, 'notices': {'ECDICT': (source / 'LICENSE').read_text(encoding='utf-8'),
                                       'ipa-dict': (source / 'ipa-dict-LICENSE').read_text(encoding='utf-8')},
           'references': {word: entry['source'] for word, entry in overrides.items() if word in data}}
(root / 'miniprogram/data/phonetics.js').write_text('module.exports=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
licenses = root / 'third-party'
licenses.mkdir(exist_ok=True)
shutil.copyfile(source / 'LICENSE', licenses / 'ECDICT-LICENSE.txt')
shutil.copyfile(source / 'ipa-dict-LICENSE', licenses / 'ipa-dict-LICENSE.txt')
report = {'entries': len(data), 'uniqueEnglish': len(terms), 'missing': missing,
          'sources': {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in ['ecdict.csv', 'en_US.txt']}}
(source / 'coverage.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
