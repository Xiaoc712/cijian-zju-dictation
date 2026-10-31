"""Download public ECDICT source data for the offline pronunciation subset builder."""
from pathlib import Path
import argparse
import shutil
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--full', action='store_true')
parser.add_argument('--american', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
destination = root / 'outputs/phonetics-source'
destination.mkdir(parents=True, exist_ok=True)
items = [(name, 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/' + name)
         for name in (('ecdict.csv' if args.full else 'ecdict.mini.csv'), 'LICENSE')]
if args.american:
    items = [('en_US.txt', 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt'),
             ('ipa-dict-LICENSE', 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/LICENSE')]
for name, url in items:
    target = destination / name
    if not target.exists() or target.stat().st_size == 0:
        request = urllib.request.Request(url,
                                         headers={'User-Agent': 'Cijian-Dictation-Builder'})
        temporary = target.with_suffix(target.suffix + '.part')
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(target)
    print(name, target.stat().st_size)
