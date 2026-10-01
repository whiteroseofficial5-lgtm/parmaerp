# fix-database.ps1 — makes the PharmaERP API able to reach a database, then loads the schema + demo data.
#
#   powershell -ExecutionPolicy Bypass -File .\fix-database.ps1
#   powershell -ExecutionPolicy Bypass -File .\fix-database.ps1 -UseDocker          # force bundled container (5433)
#   powershell -ExecutionPolicy Bypass -File .\fix-database.ps1 -UseLocalPostgres   # force the PostgreSQL on 5432
#   powershell -ExecutionPolicy Bypass -File .\fix-database.ps1 -Superuser myadmin  # superuser name for 5432
#
# It picks the bundled container if Docker is running (nothing to type), otherwise it creates the missing
# `pharma` role + database on the PostgreSQL you already run on 5432 (asks for the superuser password).

param(
  [switch]$UseDocker,
  [switch]$UseLocalPostgres,
  [string]$Superuser = 'postgres'
)

$ErrorActionPreference = 'Stop'
# On PowerShell 7.3+ a native command's non-zero exit code can become a terminating error, which would
# abort the readiness retry loop and the "already exists" checks below. Keep native exit codes ordinary.
Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false -ErrorAction SilentlyContinue
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend  = Join-Path $root 'backend'
$envFile  = Join-Path $backend '.env'
$dbUrl5433 = 'postgresql://pharma:pharma@localhost:5433/pharmaerp?schema=public'

function Set-DatabaseUrl($url) {
  if (-not (Test-Path $envFile)) { throw "Missing $envFile" }
  $text = [System.IO.File]::ReadAllText($envFile)
  if ($text -match '(?m)^DATABASE_URL=') {
    $new = [regex]::Replace($text, '(?m)^DATABASE_URL=[^\r\n]*', "DATABASE_URL=$url")
  } else {
    $new = $text.TrimEnd() + "`r`nDATABASE_URL=$url`r`n"
  }
  if ($new -ne $text) { [System.IO.File]::WriteAllText($envFile, $new, (New-Object System.Text.UTF8Encoding($false))) }
  Write-Host "  backend\.env  DATABASE_URL=$url"
}

function Test-Docker {
  try { docker version --format '{{.Server.Version}}' *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function Find-Psql {
  $c = Get-Command psql -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $f = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}

# ── which database? ──────────────────────────────────────────────────────────────
$mode = if ($UseLocalPostgres) { 'local' } elseif ($UseDocker) { 'docker' } elseif (Test-Docker) { 'docker' } else { 'local' }

if ($mode -eq 'docker') {
  Write-Host '[1/3] Starting the bundled PostgreSQL container (host port 5433) ...'
  Push-Location $root
  try {
    docker compose up -d db
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
      try { docker compose exec -T db pg_isready -U pharma *> $null } catch { }
      if ($LASTEXITCODE -eq 0) { $ready = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'The db container never became ready — inspect it with: docker compose logs db' }
  } finally { Pop-Location }
  Set-DatabaseUrl $dbUrl5433
} else {
  Write-Host '[1/3] Using the PostgreSQL already running on localhost:5432.'
  $psql = Find-Psql
  if (-not $psql) {
    throw @'
psql.exe was not found, and Docker is not running, so there is no way to reach a database.
Pick either one and re-run:
  a) start Docker Desktop, then:  powershell -ExecutionPolicy Bypass -File .\fix-database.ps1 -UseDocker
  b) add PostgreSQL's bin folder to PATH (or pass its full path), then re-run this script.
'@
  }
  Write-Host "  using $psql"
  $secure = Read-Host -Prompt "  Password for PostgreSQL superuser `"$Superuser`"" -AsSecureString
  $env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $secure).Password

  try { & $psql -U $Superuser -h localhost -tAc 'SELECT 1' *> $null } catch { }
  if ($LASTEXITCODE -ne 0) { throw "Could not log in as `"$Superuser`" with that password (wrong password, or a different superuser name — try -Superuser <name>)." }

  try { & $psql -U $Superuser -h localhost -c "CREATE ROLE pharma LOGIN PASSWORD 'pharma' CREATEDB;" *> $null } catch { }
  if ($LASTEXITCODE -ne 0) { Write-Host '  role "pharma" already exists (or could not be created) — continuing' }
  else { Write-Host '  created role "pharma"' }

  try { & $psql -U $Superuser -h localhost -c "CREATE DATABASE pharmaerp OWNER pharma;" *> $null } catch { }
  if ($LASTEXITCODE -ne 0) { Write-Host '  database "pharmaerp" already exists — continuing' }
  else { Write-Host '  created database "pharmaerp"' }
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Write-Host '  backend\.env left unchanged (still points at localhost:5432)'
}

# ── schema + demo data ───────────────────────────────────────────────────────────
Write-Host '[2/3] Pushing the Prisma schema and loading demo data ...'
Push-Location $backend
try {
  npx prisma generate
  npx prisma db push --skip-generate
  npm run seed
  Write-Host '[3/3] Verifying ...'
  npm run db:doctor
} finally { Pop-Location }

Write-Host ''
Write-Host 'Database is ready. If a backend was already running, press Ctrl+C in its window first'
Write-Host '(.env is only read when the process starts). Then launch the app:'
if ($mode -eq 'docker') {
  Write-Host '  cd E:\pharmaerp\pharmaerp'
  Write-Host '  powershell -ExecutionPolicy Bypass -File .\start-preview.ps1'
} else {
  Write-Host '  cd E:\pharmaerp\pharmaerp\backend   && npm run dev     # http://localhost:4000'
  Write-Host '  cd E:\pharmaerp\pharmaerp\frontend  && npm run dev     # http://localhost:3000'
}
Write-Host 'Sign in with admin@pharma.local / Pharma@12345'
