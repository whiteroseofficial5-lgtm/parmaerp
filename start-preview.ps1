# PharmaERP - one-command local preview (Windows PowerShell)
#
#   powershell -ExecutionPolicy Bypass -File .\start-preview.ps1
#   powershell -ExecutionPolicy Bypass -File .\start-preview.ps1 -SkipSeed     # keep existing data
#   powershell -ExecutionPolicy Bypass -File .\start-preview.ps1 -SkipDbSetup  # use your own local Postgres
#
# What it does: ensures .env files + deps, starts the bundled Postgres container (host port 5433)
# and points backend/.env at it, pushes the Prisma schema, optionally seeds demo data, then opens
# the API (4000) and web (3000).

param(
  [switch]$SkipSeed,
  [switch]$SkipDbSetup
)

$ErrorActionPreference = 'Stop'
# PowerShell 7.3+ may turn a native command's non-zero exit code into a terminating error, which would
# break the pg_isready retry loop below — keep native exit codes ordinary.
Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false -ErrorAction SilentlyContinue
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Need($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "'$name' was not found on PATH. Install it and re-run." }
}

Need node
Need npm

# Point backend/.env at a specific database (creates the key if it is missing).
function Set-DatabaseUrl($url) {
  $envFile = Join-Path $backend '.env'
  if (-not (Test-Path $envFile)) { throw "Missing $envFile" }
  $text = [System.IO.File]::ReadAllText($envFile)
  if ($text -match '(?m)^DATABASE_URL=') {
    $new = [regex]::Replace($text, '(?m)^DATABASE_URL=[^\r\n]*', "DATABASE_URL=$url")
  } else {
    $new = $text.TrimEnd() + "`r`nDATABASE_URL=$url`r`n"
  }
  if ($new -ne $text) {
    [System.IO.File]::WriteAllText($envFile, $new, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[env]  DATABASE_URL -> $url"
  } else {
    Write-Host "[env]  DATABASE_URL ok ($url)"
  }
}

# 0. port pre-flight — a stale `npm run dev` makes the new one die with EADDRINUSE
foreach ($port in 3000, 4000) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($busy) { throw "Port $port is already in use (PID $($busy.OwningProcess)). Press Ctrl+C in that window first, then re-run." }
}
Write-Host '[ports] 3000 and 4000 are free'

# 1. .env files -----------------------------------------------------------------
foreach ($pair in @(@{ env = (Join-Path $backend '.env'); example = (Join-Path $backend '.env.example') },
                    @{ env = (Join-Path $frontend '.env'); example = (Join-Path $frontend '.env.example') })) {
  if (-not (Test-Path $pair.env)) {
    if (-not (Test-Path $pair.example)) { throw "Missing $($pair.example)" }
    Copy-Item $pair.example $pair.env
    Write-Host "[env]  created $($pair.env) from .env.example"
  } else {
    Write-Host "[env]  ok      $($pair.env)"
  }
}

# 2. dependencies ---------------------------------------------------------------
foreach ($app in @($backend, $frontend)) {
  if (-not (Test-Path (Join-Path $app 'node_modules'))) {
    Write-Host "[deps] installing in $app ..."
    Push-Location $app; npm install; Pop-Location
  } else {
    Write-Host "[deps] ok      $app\node_modules"
  }
}

# 3. database -------------------------------------------------------------------
# The db service is published on host port 5433 (see docker-compose.yml) so a native
# PostgreSQL on 5432 is left alone. Skip all of this with -SkipDbSetup if you already
# have a database you want to use (backend/.env is then left untouched).
if (-not $SkipDbSetup) {
  Need docker
  $dbUrl = 'postgresql://pharma:pharma@localhost:5433/pharmaerp?schema=public'
  Push-Location $root
  try {
    Write-Host '[db]   starting postgres container on host port 5433 ...'
    docker compose up -d db | Out-Null
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
      docker compose exec -T db pg_isready -U pharma *> $null
      if ($LASTEXITCODE -eq 0) { $ready = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Postgres did not become ready. Check: docker compose logs db' }
    Write-Host '[db]   postgres is ready'
  } finally { Pop-Location }
  Set-DatabaseUrl $dbUrl
}

# 4. schema + seed (no prisma/migrations dir in this repo -> db push, same as docker-entrypoint.sh) ---
Push-Location $backend
try {
  Write-Host '[db]   prisma generate ...'
  npx prisma generate
  Write-Host '[db]   prisma db push ...'
  npx prisma db push --skip-generate
  if (-not $SkipSeed) {
    Write-Host '[db]   seeding demo data ...'
    npm run seed
  }
} finally { Pop-Location }

# 5. launch both dev servers in their own windows --------------------------------
$api = "`$host.UI.RawUI.WindowTitle='PharmaERP API :4000'; Set-Location '$backend'; npm run dev"
$web = "`$host.UI.RawUI.WindowTitle='PharmaERP Web :3000'; Set-Location '$frontend'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $api
Start-Process powershell -ArgumentList '-NoExit', '-Command', $web

# 6. wait for the web app, then open the browser --------------------------------
Write-Host '[web]  waiting for http://localhost:3000 ...'
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 2 | Out-Null; break }
  catch { Start-Sleep -Seconds 1 }
}
Start-Process 'http://localhost:3000'

Write-Host ''
Write-Host 'PharmaERP preview'
Write-Host '  Web UI : http://localhost:3000'
Write-Host '  API    : http://localhost:4000/api   (also proxied at http://localhost:3000/api)'
Write-Host '  Logins : admin@pharma.local / production@pharma.local / warehouse@pharma.local / qc@pharma.local'
Write-Host '           purchase@pharma.local / store@pharma.local / auditor@pharma.local'
Write-Host '  Password for all demo users: Pharma@12345'
Write-Host ''
Write-Host 'Close the two spawned PowerShell windows to stop the servers.'
