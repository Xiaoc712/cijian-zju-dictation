"""Package this project without dependencies, private settings or generated caches."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
destination = root.parent / '词间默写-微信小程序.zip'
excluded = {'node_modules', '__pycache__', '.git', 'outputs'}
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for source in sorted(root.rglob('*')):
        if not source.is_file() or any(part in excluded for part in source.relative_to(root).parts):
            continue
        if source.name == 'project.private.config.json' or source.suffix in {'.key','.pem'}:
            continue
        archive.write(source, Path(root.name) / source.relative_to(root))
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert 'wechat-mini/project.config.json' in archive.namelist()
    assert 'wechat-mini/registration/avatar-144.png' in archive.namelist()
    print(f'{len(archive.namelist())} files; {destination.stat().st_size} bytes; ZIP integrity OK')
print(destination)
