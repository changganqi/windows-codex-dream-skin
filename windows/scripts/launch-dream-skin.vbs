Option Explicit

Dim shell, fso, scriptDirectory, powerShell, powerShellScript
Dim port, command, exitCode, logPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
powerShellScript = fso.BuildPath(scriptDirectory, "launch-dream-skin.ps1")
powerShell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
port = "9341"

If WScript.Arguments.Count > 0 Then port = WScript.Arguments(0)
If Not IsNumeric(port) Then
  shell.Popup "Miku Skin received an invalid port.", 0, "Miku Skin", 16
  WScript.Quit 2
End If

command = QuoteArgument(powerShell) & _
  " -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File " & _
  QuoteArgument(powerShellScript) & " -Port " & port
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
  logPath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\CodexDreamSkin\launch.log")
  shell.Popup "Miku Skin could not start. See:" & vbCrLf & logPath, 0, "Miku Skin", 16
End If

WScript.Quit exitCode

Function QuoteArgument(ByVal value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
