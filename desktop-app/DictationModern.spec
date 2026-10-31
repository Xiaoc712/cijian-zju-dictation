# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

root = Path(SPECPATH)
a = Analysis(
    [str(root / 'main.py')],
    pathex=[str(root)],
    binaries=[],
    datas=[(str(root / 'app.ico'), '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter'],
    noarchive=False,
    optimize=0,
)
# Qt 的 Windows ICU 接口要求未带版本后缀的系统函数。
# 依赖扫描可能从构建环境 PATH 误收集其他工具的 ICU78（只有 _78 函数），导致 QtCore 无法加载。
# Windows 自带的 API/UCRT DLL 也交由操作系统解析。
def is_system_library(name):
    basename = Path(name).name.casefold()
    return (basename == 'icuuc.dll' or basename.startswith('icudt')
            or basename.startswith(('api-ms-', 'ext-ms-')) or basename == 'ucrtbase.dll')

a.binaries = [entry for entry in a.binaries if not is_system_library(entry[0])]
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True,
    name='大英默写器_美化版', debug=False, bootloader_ignore_signals=False,
    strip=False, upx=False, console=False, disable_windowed_traceback=False,
    argv_emulation=False, target_arch=None, codesign_identity=None,
    entitlements_file=None, icon=[str(root / 'app.ico')],
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='大英默写器_美化版')
