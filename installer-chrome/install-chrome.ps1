<#
.SYNOPSIS
  Installs or updates the "Compagnon SAP Fiori" extension in Google Chrome or Microsoft Edge from this Git repository.

.DESCRIPTION
  - With -Pull: first fetches the latest version of the repository (git pull).
  - Extracts installer-chrome\compagnon-sap-fiori-chrome.zip into a fixed folder
    (%LOCALAPPDATA%\CompagnonSAPFiori\chrome). Always the same folder: the extension keeps its ID and its settings.
  - Opens the browser's extensions page and copies the folder path to the clipboard.
  First installation: enable "Developer mode", click "Load unpacked" and paste the path.
  Update: run the script again, then click the reload arrow of the extension on the same page.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\installer-chrome\install-chrome.ps1 -Pull
  powershell -ExecutionPolicy Bypass -File .\installer-chrome\install-chrome.ps1 -Browser Edge
#>
[CmdletBinding()]
param(
  [switch]$Pull,
  [ValidateSet('Chrome', 'Edge')][string]$Browser = 'Chrome'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot   # this script lives in <repository>\installer-chrome

if ($Pull) {
  Write-Host 'Fetching the latest version of the repository...'
  git -C $repo pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull failed: fix the Git problem, then run the script again.' }
}

$zip = Join-Path $PSScriptRoot 'compagnon-sap-fiori-chrome.zip'
if (-not (Test-Path -LiteralPath $zip)) { throw "Package not found: $zip. Run the script with -Pull, or build it with: node chrome/build.js" }

if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not defined.' }
$target = Join-Path $env:LOCALAPPDATA 'CompagnonSAPFiori\chrome'
New-Item -ItemType Directory -Force -Path $target | Out-Null
# Replace the previous version's files (only inside our own folder)
Get-ChildItem -LiteralPath $target -Force | Remove-Item -Recurse -Force
Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
$version = (Get-Content -Raw -LiteralPath (Join-Path $target 'manifest.json') | ConvertFrom-Json).version
Write-Host "Compagnon SAP Fiori $version extracted to: $target"

# Browser location: registry (standard installation), then usual folders
$exeName = if ($Browser -eq 'Edge') { 'msedge.exe' } else { 'chrome.exe' }
$exe = $null
foreach ($key in "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exeName",
                 "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exeName") {
  try { $exe = (Get-ItemProperty -Path $key -ErrorAction Stop).'(default)' } catch { $exe = $null }
  if ($exe -and (Test-Path -LiteralPath $exe)) { break } else { $exe = $null }
}
if (-not $exe) {
  $candidates = if ($Browser -eq 'Edge') {
    @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
  } else {
    @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  }
  foreach ($p in $candidates) { if ($p -and (Test-Path -LiteralPath $p)) { $exe = $p; break } }
}

Set-Clipboard -Value $target
$page = if ($Browser -eq 'Edge') { 'edge://extensions' } else { 'chrome://extensions' }
Write-Host '1. On the extensions page, enable "Developer mode".'
Write-Host '2. First installation: click "Load unpacked" and paste the folder path (Ctrl+V).'
Write-Host '   Update: click the reload arrow on the "Compagnon SAP Fiori" card.'
Write-Host "   Path copied: $target"
if ($exe) { Start-Process -FilePath $exe -ArgumentList $page }
else { Write-Warning "$Browser not found: open $page yourself." }
