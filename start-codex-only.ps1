[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$installedCommon = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\engine\scripts\common-windows.ps1'
$sourceCommon = Join-Path $PSScriptRoot 'windows\scripts\common-windows.ps1'
$common = if (Test-Path -LiteralPath $installedCommon -PathType Leaf) { $installedCommon } else { $sourceCommon }
. $common

$codex = Get-DreamSkinCodexInstall
$null = Start-DreamSkinCodex -Codex $codex
