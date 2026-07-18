[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'windows\scripts\install-miku-future.ps1'
& $entry
