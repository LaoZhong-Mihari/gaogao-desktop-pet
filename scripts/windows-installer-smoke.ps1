param(
  [string]$UpgradeFromUrl = "https://github.com/LaoZhong-Mihari/gaogao-desktop-pet/releases/download/v1.0.0/Gaogao_1.0.0_x64-setup.exe"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:GITHUB_ACTIONS -ne "true" -and $env:GAOGAO_ALLOW_DESTRUCTIVE_SMOKE -ne "1") {
  throw "This smoke test replaces the current user's Gaogao installation. Run it only on a disposable account or set GAOGAO_ALLOW_DESTRUCTIVE_SMOKE=1."
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$bundleDirectory = Join-Path $projectRoot "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
$installers = @(Get-ChildItem -Path $bundleDirectory -Filter "*-setup.exe" -File)
if ($installers.Count -ne 1) {
  throw "Expected exactly one current installer in $bundleDirectory, found $($installers.Count)."
}

$currentInstaller = $installers[0].FullName
$currentVersion = [string](Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version
$tauriConfig = Get-Content (Join-Path $projectRoot "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json
if ($tauriConfig.bundle.windows.webviewInstallMode.type -ne "offlineInstaller") {
  throw "Windows bundles must include the offline WebView2 installer."
}
if ((Get-Item -LiteralPath $currentInstaller).Length -lt 50MB) {
  throw "The current NSIS installer is too small to contain the offline WebView2 runtime."
}
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\糕糕桌宠"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$appDataDirectory = Join-Path $env:APPDATA "com.laozhongmihari.gaogao"
$settingsPath = Join-Path $appDataDirectory "settings.json"
$sentinelPath = Join-Path $appDataDirectory "upgrade-smoke.sentinel"
$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "gaogao-v1-upgrade-smoke-$([guid]::NewGuid().ToString('N'))"
$oldInstaller = Join-Path $tempDirectory "Gaogao_1.0.0_x64-setup.exe"
$savedWebViewArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS

function Stop-Gaogao {
  Get-Process -Name "gaogao-desktop-pet" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}

function Get-GaogaoUninstallEntry {
  if (-not (Test-Path $uninstallKey)) {
    return $null
  }
  return Get-ItemProperty -Path $uninstallKey
}

function Invoke-SilentInstaller([string]$Path) {
  Write-Host "Installing $Path"
  $process = Start-Process -FilePath $Path -ArgumentList "/S" -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Installer $Path failed with exit code $($process.ExitCode)."
  }
}

function Wait-ForUninstallEntry {
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    $entry = Get-GaogaoUninstallEntry
    if ($null -ne $entry) {
      return $entry
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Gaogao uninstall registry entry was not created."
}

function Uninstall-Gaogao {
  $entry = Get-GaogaoUninstallEntry
  if ($null -eq $entry) {
    return
  }
  $installLocation = ([string]$entry.InstallLocation).Trim('"')
  $uninstaller = Join-Path $installLocation "uninstall.exe"
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    throw "The uninstall entry exists, but the uninstaller is missing at $uninstaller."
  }
  $process = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Uninstaller failed with exit code $($process.ExitCode)."
  }
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if (-not (Test-Path $uninstallKey)) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Gaogao uninstall registry entry remains after silent uninstall."
}

try {
  Stop-Gaogao
  Uninstall-Gaogao
  Remove-Item -LiteralPath $appDataDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKey -Name "糕糕桌宠" -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null

  Write-Host "Downloading the public v1.0.0 upgrade baseline"
  Invoke-WebRequest -Uri $UpgradeFromUrl -OutFile $oldInstaller
  Invoke-SilentInstaller $oldInstaller
  Stop-Gaogao

  $oldEntry = Wait-ForUninstallEntry
  $oldInstallLocation = ([string]$oldEntry.InstallLocation).Trim('"')
  $oldMainBinary = [string]$oldEntry.MainBinaryName
  $oldAppPath = Join-Path $oldInstallLocation $oldMainBinary
  if (-not (Test-Path -LiteralPath $oldAppPath -PathType Leaf)) {
    throw "The v1.0.0 application binary was not found at $oldAppPath."
  }
  $oldAppHash = (Get-FileHash -LiteralPath $oldAppPath -Algorithm SHA256).Hash

  New-Item -ItemType Directory -Path $appDataDirectory -Force | Out-Null
  $settings = [ordered]@{
    "pet-settings-v1" = [ordered]@{
      scale = 1.25
      growthBonus = 0.17
      alwaysOnTop = $false
      attentionEnabled = $false
      autoRoam = $false
      launchAtLogin = $false
      windowPosition = $null
    }
  }
  [System.IO.File]::WriteAllText(
    $settingsPath,
    ($settings | ConvertTo-Json -Depth 5),
    [System.Text.UTF8Encoding]::new($false)
  )
  [System.IO.File]::WriteAllText($sentinelPath, "preserve-v1-settings")
  Remove-ItemProperty -Path $runKey -Name "糕糕桌宠" -ErrorAction SilentlyContinue

  Invoke-SilentInstaller $currentInstaller

  $newEntry = Wait-ForUninstallEntry
  $newInstallLocation = ([string]$newEntry.InstallLocation).Trim('"')
  $newMainBinary = [string]$newEntry.MainBinaryName
  $newAppPath = Join-Path $newInstallLocation $newMainBinary
  if ($newInstallLocation -ne $oldInstallLocation) {
    throw "Upgrade changed InstallLocation from $oldInstallLocation to $newInstallLocation."
  }
  if ([string]$newEntry.DisplayVersion -ne $currentVersion) {
    throw "DisplayVersion is $($newEntry.DisplayVersion); expected $currentVersion."
  }
  if (-not (Test-Path -LiteralPath $newAppPath -PathType Leaf)) {
    throw "The upgraded application binary was not found at $newAppPath."
  }
  $newAppHash = (Get-FileHash -LiteralPath $newAppPath -Algorithm SHA256).Hash
  if ($newAppHash -eq $oldAppHash) {
    throw "The v1.0.0 application binary was not replaced during upgrade."
  }

  $matchingEntries = @(
    Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" |
      ForEach-Object { Get-ItemProperty $_.PSPath } |
      Where-Object {
        $_.PSObject.Properties["DisplayName"] -and
        $_.DisplayName -eq "糕糕桌宠"
      }
  )
  if ($matchingEntries.Count -ne 1) {
    throw "Expected one Gaogao uninstall entry after upgrade, found $($matchingEntries.Count)."
  }
  if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf)) {
    throw "The upgrade removed application data."
  }
  $preserved = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  $petSettings = $preserved."pet-settings-v1"
  if (
    [double]$petSettings.scale -ne 1.25 -or
    [double]$petSettings.growthBonus -ne 0.17 -or
    [bool]$petSettings.launchAtLogin
  ) {
    throw "The upgrade did not preserve the v1.0.0 settings sentinel."
  }

  Remove-ItemProperty -Path $runKey -Name "糕糕桌宠" -ErrorAction SilentlyContinue
  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )
  $listener.Start()
  $debugPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort --remote-allow-origins=*"

  Write-Host "Launching upgraded Gaogao from $newAppPath"
  $app = Start-Process -FilePath $newAppPath -PassThru
  & node (Join-Path $PSScriptRoot "assert-windows-pet-ready.mjs") $debugPort
  if ($LASTEXITCODE -ne 0) {
    throw "The upgraded Gaogao frontend did not reach the ready state."
  }
  $app.Refresh()
  if ($app.HasExited) {
    throw "The upgraded application exited with code $($app.ExitCode)."
  }
  $runValue = Get-ItemPropertyValue -Path $runKey -Name "糕糕桌宠" -ErrorAction SilentlyContinue
  if ($null -ne $runValue) {
    throw "Launch-at-login should remain disabled after the upgraded app starts."
  }

  Write-Host "Windows v1.0.0 -> $currentVersion upgrade and frontend readiness smoke test passed."
}
finally {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $savedWebViewArguments
  Stop-Gaogao
  Uninstall-Gaogao
  Remove-Item -LiteralPath $appDataDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKey -Name "糕糕桌宠" -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
