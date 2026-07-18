[CmdletBinding()]
param([int]$Port = 9341)

$ErrorActionPreference = 'Stop'
$entry = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\engine\scripts\start-dream-skin.ps1'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw 'Miku Skin is not installed. Run install.bat first.'
}
& $entry -Port $Port -RestartExisting
