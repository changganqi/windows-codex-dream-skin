[CmdletBinding()]
param([int]$Port = 9341)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$logPath = Join-Path $stateRoot 'launch.log'
$startScript = Join-Path $PSScriptRoot 'start-dream-skin.ps1'
$utf8 = [System.Text.UTF8Encoding]::new($false)

if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
  [System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
}

function Write-DreamSkinLaunchLog {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text, [switch]$Append)
  if ($Append) {
    [System.IO.File]::AppendAllText($logPath, $Text, $utf8)
  } else {
    [System.IO.File]::WriteAllText($logPath, $Text, $utf8)
  }
}

$header = "[$((Get-Date).ToString('o'))] Hidden launch on port $Port`r`n"
Write-DreamSkinLaunchLog -Text $header
try {
  $output = (& $startScript -Port $Port -RestartExisting 2>&1 | Out-String)
  $completed = "[$((Get-Date).ToString('o'))] Hidden launch completed successfully.`r`n" + $output
  Write-DreamSkinLaunchLog -Text $completed -Append
  exit 0
} catch {
  Write-DreamSkinLaunchLog -Text (($_ | Out-String) + "`r`n") -Append
  exit 1
}
