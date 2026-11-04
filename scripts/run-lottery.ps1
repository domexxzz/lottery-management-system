param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir
)

$ErrorActionPreference = "Stop"
$serverProcess = $null
$stdoutLog = Join-Path $env:TEMP "lottery-dev.stdout.log"
$stderrLog = Join-Path $env:TEMP "lottery-dev.stderr.log"

function Stop-LotteryServer {
  if ($null -eq $script:serverProcess -or $script:serverProcess.HasExited) {
    return
  }

  Start-Process -FilePath "taskkill.exe" `
    -ArgumentList "/PID", $script:serverProcess.Id, "/T", "/F" `
    -WindowStyle Hidden `
    -Wait | Out-Null
  $script:serverProcess = $null
}

function Start-LotteryServer {
  $script:serverProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $ProjectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  Write-Host "Starting Lottery Management System..."

  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if ($script:serverProcess.HasExited) {
      Write-Host "Server stopped before it was ready." -ForegroundColor Red
      Write-Host "Logs: $stdoutLog"
      Write-Host "Errors: $stderrLog"
      return $false
    }

    try {
      $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "Ready: http://localhost:3000" -ForegroundColor Green
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  Write-Host "Server did not become ready in time." -ForegroundColor Red
  Write-Host "Logs: $stdoutLog"
  Write-Host "Errors: $stderrLog"
  return $false
}

try {
  if (Start-LotteryServer) {
    Start-Process "http://localhost:3000"
  }

  while ($true) {
    Write-Host ""
    Write-Host "[R] Restart server    [Q] Quit"
    $key = [Console]::ReadKey($true).KeyChar.ToString().ToLowerInvariant()

    if ($key -eq "r") {
      Write-Host "Restarting..." -ForegroundColor Yellow
      Stop-LotteryServer
      Start-LotteryServer | Out-Null
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
