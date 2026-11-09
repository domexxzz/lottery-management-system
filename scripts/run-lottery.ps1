param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir
)

$ErrorActionPreference = "Stop"
$serverProcess = $null
$ownsServer = $false
$stdoutLog = Join-Path $env:TEMP "lottery-dev.stdout.log"
$stderrLog = Join-Path $env:TEMP "lottery-dev.stderr.log"
$appUrl = "http://localhost:3000"
$healthUrl = "$appUrl/api/health"

function Test-LotteryHealth {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $response.status -eq "ok" -and $response.database -eq "up"
  } catch {
    return $false
  }
}

function Show-LotteryLogs {
  Write-Host "Logs: $stdoutLog"
  Write-Host "Errors: $stderrLog"

  if (Test-Path -LiteralPath $stderrLog) {
    $recentErrors = @(Get-Content -LiteralPath $stderrLog -Tail 12)
    if ($recentErrors.Count -gt 0) {
      Write-Host ""
      Write-Host "Recent errors:" -ForegroundColor Yellow
      $recentErrors | ForEach-Object { Write-Host $_ }
    }
  }
}

function Stop-LotteryServer {
  if (-not $script:ownsServer -or $null -eq $script:serverProcess -or $script:serverProcess.HasExited) {
    return
  }

  Start-Process -FilePath "taskkill.exe" `
    -ArgumentList "/PID", $script:serverProcess.Id, "/T", "/F" `
    -WindowStyle Hidden `
    -Wait | Out-Null
  $script:serverProcess = $null
  $script:ownsServer = $false
}

function Start-LotteryServer {
  if (Test-LotteryHealth) {
    $script:serverProcess = $null
    $script:ownsServer = $false
    Write-Host "Lottery is already running at $appUrl" -ForegroundColor Green
    return $true
  }

  $portOwner = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $portOwner) {
    Write-Host "Port 3000 is being used by process $($portOwner.OwningProcess), but Lottery health check failed." -ForegroundColor Red
    Write-Host "Close that process, then press R to try again." -ForegroundColor Yellow
    return $false
  }

  if (Test-Path -LiteralPath $stdoutLog) { Clear-Content -LiteralPath $stdoutLog }
  if (Test-Path -LiteralPath $stderrLog) { Clear-Content -LiteralPath $stderrLog }

  $script:serverProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run", "dev", "--", "--port", "3000" `
    -WorkingDirectory $ProjectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
  $script:ownsServer = $true

  Write-Host "Starting Lottery Management System..."

  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    if ($script:serverProcess.HasExited) {
      Write-Host "Server stopped before it was ready." -ForegroundColor Red
      Show-LotteryLogs
      $script:serverProcess = $null
      $script:ownsServer = $false
      return $false
    }

    if (Test-LotteryHealth) {
      Write-Host "Ready: $appUrl" -ForegroundColor Green
      return $true
    }

    Start-Sleep -Seconds 1
  }

  Write-Host "Server did not become ready in time." -ForegroundColor Red
  Show-LotteryLogs
  Stop-LotteryServer
  return $false
}

try {
  if (Start-LotteryServer) {
    Start-Process $appUrl
  }

  while ($true) {
    Write-Host ""
    Write-Host "[R] Restart server    [Q] Quit"
    $key = [Console]::ReadKey($true).KeyChar.ToString().ToLowerInvariant()

    if ($key -eq "r") {
      Write-Host "Restarting..." -ForegroundColor Yellow
      Stop-LotteryServer
      if (Start-LotteryServer) {
        Start-Process $appUrl
      }
      continue
    }

    if ($key -eq "q") {
      Write-Host "Closing..."
      break
    }
  }
} finally {
  Stop-LotteryServer
}
