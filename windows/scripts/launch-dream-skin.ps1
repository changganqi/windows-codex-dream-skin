[CmdletBinding()]
param([int]$Port = 9341)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$logPath = Join-Path $stateRoot 'launch.log'
$startScript = Join-Path $PSScriptRoot 'start-dream-skin.ps1'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
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

function Test-DreamSkinOverlappingLaunchComplete {
  try {
    $codex = Get-DreamSkinCodexInstall
    if ($null -eq (Get-DreamSkinVerifiedCdpIdentity -Port $Port -Codex $codex)) { return $false }
    $state = Read-DreamSkinState -Path (Join-Path $stateRoot 'state.json')
    if ($null -eq $state -or -not $state.injectorPid) { return $false }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$state.injectorPid)" -ErrorAction SilentlyContinue
    return [bool]($process -and "$($process.CommandLine)" -match 'injector\.mjs')
  } catch {
    return $false
  }
}

function Wait-DreamSkinOverlappingLaunch {
  $deadline = (Get-Date).AddSeconds(60)
  do {
    if (Test-DreamSkinOverlappingLaunchComplete) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

$header = "[$((Get-Date).ToString('o'))] Hidden launch on port $Port`r`n"
Write-DreamSkinLaunchLog -Text $header
try {
  $output = (& $startScript -Port $Port -RestartExisting 2>&1 | Out-String)
  $completed = "[$((Get-Date).ToString('o'))] Hidden launch completed successfully.`r`n" + $output
  Write-DreamSkinLaunchLog -Text $completed -Append
  exit 0
} catch {
  $errorText = ($_ | Out-String)
  if ($errorText -match 'Another Codex Dream Skin .*already running' -and
      (Wait-DreamSkinOverlappingLaunch)) {
    Write-DreamSkinLaunchLog -Text "[$((Get-Date).ToString('o'))] An overlapping launch completed successfully.`r`n" -Append
    exit 0
  }
  Write-DreamSkinLaunchLog -Text ($errorText + "`r`n") -Append
  exit 1
}
