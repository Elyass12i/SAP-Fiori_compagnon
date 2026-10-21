<#
.SYNOPSIS
  Installs the "Compagnon SAP Fiori" Firefox extension from this Git repository.

.DESCRIPTION
  - With -Pull: first fetches the latest version of the repository (git pull).
  - Takes compagnon-sap-fiori.xpi from this folder (or the most recent .xpi) and detects whether it is signed by Mozilla.
  - Signed package: opens it in Firefox, which shows the installation prompt (permanent installation).
  - Unsigned package: opens about:debugging and copies the file path (temporary installation).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\installer-firefox\install.ps1 -Pull
#>
[CmdletBinding()]
param(
  [string]$Xpi,
  [switch]$Pull
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot   # this script lives in <repository>\installer-firefox

if ($Pull) {
  Write-Host 'Fetching the latest version of the repository...'
  git -C $repo pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull failed: fix the Git problem, then run the script again.' }
}

if (-not $Xpi) {
  $dist = $PSScriptRoot
  $all = @(Get-ChildItem -Path $dist -Filter '*.xpi' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  $pick = $all | Where-Object { $_.Name -eq 'compagnon-sap-fiori.xpi' } | Select-Object -First 1
  if (-not $pick) { $pick = $all | Select-Object -First 1 }
  if (-not $pick) { throw "No .xpi file in $dist. Run the script with -Pull, or build the package (see README)." }
  $Xpi = $pick.FullName
}
$Xpi = (Resolve-Path -LiteralPath $Xpi).Path
# A package signed by Mozilla contains a META-INF folder (signature); an unsigned package does not
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Xpi)
try { $signed = [bool]($zip.Entries | Where-Object { $_.FullName -like 'META-INF/*' } | Select-Object -First 1) }
finally { $zip.Dispose() }

# Firefox location: registry (standard installation), then usual folders
$firefox = $null
foreach ($key in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
                 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe') {
  try { $firefox = (Get-ItemProperty -Path $key -ErrorAction Stop).'(default)' } catch { $firefox = $null }
  if ($firefox -and (Test-Path -LiteralPath $firefox)) { break } else { $firefox = $null }
}
if (-not $firefox) {
  foreach ($p in "$env:ProgramFiles\Mozilla Firefox\firefox.exe", "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe", "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe") {
    if ($p -and (Test-Path -LiteralPath $p)) { $firefox = $p; break }
  }
}
if (-not $firefox) { throw 'Firefox not found. Install Firefox, or load the .xpi manually from about:addons.' }

if ($signed) {
  Write-Host "Opening $(Split-Path -Leaf $Xpi) in Firefox: confirm the installation in the prompt that appears."
  Start-Process -FilePath $firefox -ArgumentList ('"' + $Xpi + '"')
} else {
  Set-Clipboard -Value $Xpi
  Write-Warning 'Unsigned package: standard Firefox only installs it temporarily (until the next restart).'
  Write-Host '1. On the page that opens, click "Load Temporary Add-on...".'
  Write-Host '2. In the file dialog, paste the path (Ctrl+V) into "File name" and confirm.'
  Write-Host "   Path copied: $Xpi"
  Write-Host 'For a permanent installation, have the package signed: see sign.ps1 or the README.'
  Start-Process -FilePath $firefox -ArgumentList 'about:debugging#/runtime/this-firefox'
}
