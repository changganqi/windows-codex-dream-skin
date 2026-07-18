Option Explicit

Dim shell, fso, launcher, wscriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

launcher = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\CodexDreamSkin\engine\scripts\launch-dream-skin.vbs")
wscriptPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")

If Not fso.FileExists(launcher) Then
  shell.Popup "Miku Skin is not installed. Run install.bat first.", 0, "Miku Skin", 16
  WScript.Quit 1
End If

command = QuoteArgument(wscriptPath) & " " & QuoteArgument(launcher) & " 9341"
shell.Run command, 0, False

Function QuoteArgument(ByVal value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
