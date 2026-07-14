$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$bundleDirectory = Join-Path $PSScriptRoot "../src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
$installers = @(Get-ChildItem -Path $bundleDirectory -Filter "*-setup.exe" -File)
if ($installers.Count -ne 1) {
  throw "Expected exactly one NSIS installer in $bundleDirectory, found $($installers.Count)."
}

$installer = $installers[0].FullName
Write-Host "Installing $installer"
$install = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
if ($install.ExitCode -ne 0) {
  throw "Silent installation failed with exit code $($install.ExitCode)."
}

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\糕糕桌宠"
$entry = $null
for ($attempt = 0; $attempt -lt 20 -and $null -eq $entry; $attempt += 1) {
  if (Test-Path $uninstallKey) {
    $entry = Get-ItemProperty -Path $uninstallKey
    break
  }
  Start-Sleep -Milliseconds 250
}
if ($null -eq $entry) {
  throw "The installer did not create the expected per-user uninstall entry."
}

$installLocation = ([string]$entry.InstallLocation).Trim('"')
$mainBinaryName = [string]$entry.MainBinaryName
$appPath = Join-Path $installLocation $mainBinaryName
$uninstallerPath = Join-Path $installLocation "uninstall.exe"
if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) {
  throw "Installed application was not found at $appPath."
}
if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
  throw "Uninstaller was not found at $uninstallerPath."
}

Write-Host "Launching $appPath"
$app = Start-Process -FilePath $appPath -PassThru
try {
  Start-Sleep -Seconds 5
  $app.Refresh()
  if ($app.HasExited) {
    throw "Installed application exited during the startup smoke test with code $($app.ExitCode)."
  }
  if (-not (Get-Process -Name "gaogao-desktop-pet" -ErrorAction SilentlyContinue)) {
    throw "Installed application process was not found after launch."
  }
}
finally {
  Get-Process -Name "gaogao-desktop-pet" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

Write-Host "Uninstalling $uninstallerPath"
$uninstall = Start-Process -FilePath $uninstallerPath -ArgumentList "/S" -Wait -PassThru
if ($uninstall.ExitCode -ne 0) {
  throw "Silent uninstallation failed with exit code $($uninstall.ExitCode)."
}

for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  if (-not (Test-Path -LiteralPath $appPath) -and -not (Test-Path $uninstallKey)) {
    break
  }
  Start-Sleep -Milliseconds 250
}
if (Test-Path -LiteralPath $appPath) {
  throw "Application executable remains after uninstall: $appPath"
}
if (Test-Path $uninstallKey) {
  throw "Uninstall registry entry remains after uninstall: $uninstallKey"
}
if (Get-Process -Name "gaogao-desktop-pet" -ErrorAction SilentlyContinue) {
  throw "Application process remains after uninstall."
}

Write-Host "Windows NSIS install, launch, and uninstall smoke test passed."
