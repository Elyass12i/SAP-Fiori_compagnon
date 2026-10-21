<#
.SYNOPSIS
  Has the extension signed by Mozilla (unlisted distribution: nothing is published) and stores the signed package in the repository.

.DESCRIPTION
  Requirements: Node.js and AMO API keys (https://addons.mozilla.org/developers/addon/api/key/).
  Mozilla refuses to sign the same version number twice: increase "version" in manifest.json before each new signature.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\installer-firefox\sign.ps1 -ApiKey "user:123:45" -ApiSecret "..."
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ApiKey,
  [Parameter(Mandatory = $true)][string]$ApiSecret
)
$ErrorActionPreference = 'Stop'
$dist = $PSScriptRoot
$repo = Split-Path -Parent $dist
$src = Join-Path $repo 'firefox-sap-compagnon'
$version = (Get-Content -Raw -LiteralPath (Join-Path $src 'manifest.json') | ConvertFrom-Json).version
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('sapc-sign-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

Write-Host "Signing version $version with Mozilla (usually a few minutes)..."
npx --yes web-ext@8.10.0 sign --source-dir $src --channel unlisted --api-key $ApiKey --api-secret $ApiSecret --artifacts-dir $tmp
if ($LASTEXITCODE -ne 0) { throw 'Signing failed (see the web-ext message above). Version already signed? Increase "version" in manifest.json.' }

$signedFile = Get-ChildItem -Path $tmp -Filter '*.xpi' | Select-Object -First 1
if (-not $signedFile) { throw "No signed file received in $tmp." }
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Get-ChildItem -Path $dist -Filter '*.xpi' | Remove-Item
$target = Join-Path $dist 'compagnon-sap-fiori.xpi'
Move-Item -LiteralPath $signedFile.FullName -Destination $target
Remove-Item -Recurse -Force $tmp
Write-Host "Signed package: $target"
Write-Host 'Install it with install.ps1, then git add / commit / push to share it.'
