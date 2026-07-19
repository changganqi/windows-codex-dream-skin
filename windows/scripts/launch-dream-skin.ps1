[CmdletBinding()]
param([int]$Port = 9341)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$logPath = Join-Path $stateRoot 'launch.log'
$historyPath = Join-Path $stateRoot 'launch-history.log'
$startScript = Join-Path $PSScriptRoot 'start-dream-skin.ps1'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
$utf8 = [System.Text.UTF8Encoding]::new($false)
$launchId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$attemptPath = Join-Path $stateRoot "launch-$launchId.tmp.log"
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
  [System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
}

function Write-DreamSkinLaunchLog {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text, [switch]$Append)
  if ($Append) {
    [System.IO.File]::AppendAllText($attemptPath, $Text, $utf8)
  } else {
    [System.IO.File]::WriteAllText($attemptPath, $Text, $utf8)
  }
}

function Publish-DreamSkinLaunchLog {
  try {
    if (-not (Test-Path -LiteralPath $attemptPath -PathType Leaf)) { return $false }
    $content = [System.IO.File]::ReadAllText($attemptPath, $utf8)
    Write-DreamSkinUtf8FileAtomically -Path $logPath -Content $content
    $separator = "`r`n===== launch $launchId =====`r`n"
    [System.IO.File]::AppendAllText($historyPath, $separator + $content, $utf8)
    return $true
  } catch {
    # The attempt log remains available if publishing diagnostics fails.
    return $false
  }
}

function Test-DreamSkinOverlappingLaunchComplete {
  try {
    $codex = Get-DreamSkinCodexInstall
    $identity = Get-DreamSkinVerifiedCdpIdentity -Port $Port -Codex $codex
    if ($null -eq $identity) { return $false }
    $state = Read-DreamSkinState -Path (Join-Path $stateRoot 'state.json')
    if ($null -eq $state -or "$($state.browserId)" -cne "$($identity.BrowserId)") { return $false }
    return Test-DreamSkinRecordedInjectorActive -State $state
  } catch {
    return $false
  }
}

function Wait-DreamSkinOverlappingLaunch {
  $deadline = (Get-Date).AddSeconds(150)
  do {
    if (Test-DreamSkinOverlappingLaunchComplete) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

$header = "[$((Get-Date).ToString('o'))] [$launchId] Hidden launch on port $Port using $startScript`r`n"
Write-DreamSkinLaunchLog -Text $header
$exitCode = 0
try {
  if (Test-DreamSkinOverlappingLaunchComplete) {
    Write-DreamSkinLaunchLog -Text "[$((Get-Date).ToString('o'))] [$launchId] Dream Skin is already active; no watcher restart was needed. Elapsed: $($stopwatch.ElapsedMilliseconds) ms.`r`n" -Append
  } else {
    $output = (& $startScript -Port $Port -RestartExisting -CdpReadyTimeoutSeconds 90 `
      -LaunchLogPath $attemptPath -LaunchId $launchId 2>&1 | Out-String)
    if ($output) { Write-DreamSkinLaunchLog -Text ($output.TrimEnd() + "`r`n") -Append }
    $completed = "[$((Get-Date).ToString('o'))] [$launchId] Hidden launch completed successfully. Elapsed: $($stopwatch.ElapsedMilliseconds) ms.`r`n"
    Write-DreamSkinLaunchLog -Text $completed -Append
  }
} catch {
  $errorText = ($_ | Out-String)
  if ($errorText -match 'Another Codex Dream Skin .*already running' -and
      (Wait-DreamSkinOverlappingLaunch)) {
    Write-DreamSkinLaunchLog -Text "[$((Get-Date).ToString('o'))] [$launchId] An overlapping launch completed successfully. Elapsed: $($stopwatch.ElapsedMilliseconds) ms.`r`n" -Append
  } else {
    Write-DreamSkinLaunchLog -Text ($errorText + "`r`n") -Append
    Write-DreamSkinLaunchLog -Text "[$((Get-Date).ToString('o'))] [$launchId] Hidden launch failed after $($stopwatch.ElapsedMilliseconds) ms.`r`n" -Append
    $exitCode = 1
  }
} finally {
  $stopwatch.Stop()
  $published = Publish-DreamSkinLaunchLog
  if ($published) { Remove-Item -LiteralPath $attemptPath -Force -ErrorAction SilentlyContinue }
}
exit $exitCode
