[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
$node = Get-DreamSkinNodeRuntime
$script = Join-Path $PSScriptRoot 'install-miku-future.mjs'
& $node.Path $script
if ($LASTEXITCODE -ne 0) { throw "Miku Future installation failed with exit code $LASTEXITCODE." }
