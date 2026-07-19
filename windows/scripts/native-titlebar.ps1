[CmdletBinding()]
param(
  [ValidateSet('auto', 'light', 'dark')]
  [string]$Appearance = 'auto',
  [string]$CaptionColor = '',
  [string]$TextColor = '',
  [int]$RetrySeconds = 15
)

$ErrorActionPreference = 'Stop'

if (-not ('CodexDreamDwm.NativeTitleBar' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace CodexDreamDwm {
  public static class NativeTitleBar {
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int valueSize);

    public static int Set(IntPtr hwnd, bool dark, int captionColor, int textColor) {
      int mode = dark ? 1 : 0;
      int modeResult = DwmSetWindowAttribute(hwnd, 20, ref mode, 4);
      if (modeResult != 0) {
        // Windows 10 builds before the documented attribute used 19.
        modeResult = DwmSetWindowAttribute(hwnd, 19, ref mode, 4);
      }
      int caption = captionColor;
      int captionResult = DwmSetWindowAttribute(hwnd, 35, ref caption, 4);
      int text = textColor;
      int textResult = DwmSetWindowAttribute(hwnd, 36, ref text, 4);
      if (modeResult != 0) return modeResult;
      if (captionResult != 0) return captionResult;
      return textResult;
    }
  }
}
'@
}

function ConvertTo-DreamSkinColorRef {
  param([string]$Value, [int]$Fallback)
  if (-not $Value -or $Value -notmatch '^#?(?<r>[0-9a-fA-F]{2})(?<g>[0-9a-fA-F]{2})(?<b>[0-9a-fA-F]{2})$') {
    return $Fallback
  }
  $r = [Convert]::ToInt32($Matches.r, 16)
  $g = [Convert]::ToInt32($Matches.g, 16)
  $b = [Convert]::ToInt32($Matches.b, 16)
  return [int]($r -bor ($g -shl 8) -bor ($b -shl 16))
}

function Test-DreamSkinDarkMode {
  param([string]$Value)
  if ($Value -eq 'dark') { return $true }
  if ($Value -eq 'light') { return $false }
  try {
    $personalize = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction Stop
    return ([int]$personalize.AppsUseLightTheme -eq 0)
  } catch {
    return $false
  }
}

$dark = Test-DreamSkinDarkMode -Value $Appearance
$captionFallback = if ($dark) { 0x002e1a17 } else { 0x00fcf6f5 }
$textFallback = if ($dark) { 0x00c8e6f0 } else { 0x00602c12 }
$caption = ConvertTo-DreamSkinColorRef -Value $CaptionColor -Fallback $captionFallback
$text = ConvertTo-DreamSkinColorRef -Value $TextColor -Fallback $textFallback
$deadline = (Get-Date).AddSeconds([Math]::Max(1, $RetrySeconds))
$applied = $false

do {
  $processes = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  foreach ($process in $processes) {
    try {
      $result = [CodexDreamDwm.NativeTitleBar]::Set(
        [IntPtr]$process.MainWindowHandle,
        $dark,
        $caption,
        $text
      )
      if ($result -eq 0) { $applied = $true }
    } catch {
      # The app can replace its top-level window while it is loading.
    }
  }
  if ($applied) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if (-not $applied) { exit 2 }
exit 0
