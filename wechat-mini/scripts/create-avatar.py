"""Export the selected generated icon at app and registration sizes."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'registration/icon-master.png'
if not source.exists():
    raise SystemExit('Missing registration/icon-master.png; see registration/图标设计.md')
with Image.open(source) as image:
    for edge in (144, 512):
        image.resize((edge, edge), Image.Resampling.LANCZOS).save(root / f'registration/avatar-{edge}.png', optimize=True)
    # Runtime exports match their display sizes; high-resolution masters stay outside the upload root.
    image.resize((144, 144), Image.Resampling.LANCZOS).save(root / 'miniprogram/assets/logo.png', optimize=True)
    image.resize((320, 320), Image.Resampling.LANCZOS).save(root / 'miniprogram/assets/share-cover.png', optimize=True)
print(root / 'registration/avatar-144.png')
