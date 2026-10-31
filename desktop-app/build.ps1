$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
python -m PyInstaller --noconfirm --clean --distpath release --workpath build DictationModern.spec
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
$appOutput = Join-Path $PSScriptRoot 'release/大英默写器_美化版'
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'data') -Recurse -Filter '*.csv' | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($PSScriptRoot, $_.FullName)
    $target = Join-Path $appOutput $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination $appOutput -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../NOTICE.md') -Destination $appOutput -Force
Write-Output $appOutput
