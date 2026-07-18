[CmdletBinding()]
param(
  [int]$Port = 9341,
  [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'windows\scripts\install-dream-skin.ps1'
& $entry -Port $Port -NoShortcuts:$NoShortcuts
