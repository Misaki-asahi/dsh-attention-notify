#Requires -Version 5.1
<#
.SYNOPSIS
  Install dsh-attention-notify as a DSH skill, and (unless -SkipPlugin) as a plugin.

.DESCRIPTION
  Clones the repository into <DSH_HOME>/skills/dsh-attention-notify, then lets
  `dsh plugin add` link that same directory into the profile. The skill base
  directory is the plugin package, so no second copy is ever created.

  The script is idempotent: an existing git checkout is fast-forwarded, an
  existing non-git directory is left alone and reported as an error.

.PARAMETER Repo
  Repository to clone. Defaults to the upstream GitHub URL.

.PARAMETER DshHome
  DSH home. Defaults to $env:DSH_HOME, else ~\.dsh.

.PARAMETER Profile
  Profile that receives the plugin. Defaults to $env:DSH_PROFILE, else desktop.

.PARAMETER SkipPlugin
  Only install the skill; print the plugin command instead of running it.

.EXAMPLE
  .\install.ps1
.EXAMPLE
  .\install.ps1 -SkipPlugin -DshHome C:\tmp\dsh-home
#>
[CmdletBinding()]
param(
  [string]$Repo = 'https://github.com/Misaki-asahi/dsh-attention-notify.git',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
  [switch]$SkipPlugin
)

$ErrorActionPreference = 'Stop'
$name = 'dsh-attention-notify'
$skillsDir = Join-Path $DshHome 'skills'
$target = Join-Path $skillsDir $name

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git is required to install this skill.'
}

Write-Host "skill directory: $target"
if (Test-Path -LiteralPath (Join-Path $target '.git')) {
  Write-Host 'existing checkout: fast-forwarding'
  git -C $target pull --ff-only
} elseif (Test-Path -LiteralPath $target) {
  throw "$target already exists and is not a git checkout. Move it away first (a junction or a copy), then rerun."
} else {
  New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
  git clone --depth 1 $Repo $target
}
if ($LASTEXITCODE -ne 0) { throw "git failed with exit code $LASTEXITCODE" }

if ($SkipPlugin) {
  Write-Host 'plugin step skipped (-SkipPlugin)'
} elseif (Get-Command dsh -ErrorAction SilentlyContinue) {
  Write-Host "installing the plugin into profile '$Profile'"
  dsh plugin --profile $Profile add $target
  if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed with exit code $LASTEXITCODE" }
} else {
  Write-Host "dsh is not on PATH; run: dsh plugin --profile $Profile add `"$target`""
}

Write-Host ''
Write-Host 'Next: reload the host half once (the client half hot-reloads by itself):'
Write-Host "  plugin_manager action=set_bundle target=$name enabled=false"
Write-Host "  plugin_manager action=set_bundle target=$name enabled=true"
Write-Host 'or restart DSH.'
Write-Host ''
Write-Host 'Verify:'
Write-Host "  node `"$(Join-Path $target 'tests/render.test.mjs')`""
Write-Host '  then ask the running session a question; the card appears top-right.'
Write-Host ''
if ($env:OS -ne 'Windows_NT') {
  Write-Host 'Note: the always-on-top card exists only on Windows; elsewhere the plugin falls back to OS notifications.'
}
