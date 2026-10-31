<#
.SYNOPSIS
    One-Click Public HTTPS Cloud Tunnel for Demo Operations Suite.
    Exposes Unified FastAPI Backend (Port 8010) to the public internet
    so both Web Cockpit and Mobile APK work from anywhere online.
#>

param(
    [string]$TunnelService = "localtunnel", # options: localtunnel, cloudflared, ngrok
    [int]$Port = 8010
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Demo Operations Suite: One-Click Public Cloud Tunnel   " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Target: Exposing local backend at http://127.0.0.1:$Port"
Write-Host "Starting tunnel via $TunnelService..."

if ($TunnelService -eq "localtunnel") {
    Write-Host "Starting npx localtunnel --port $Port..." -ForegroundColor Green
    npx localtunnel --port $Port
}
elseif ($TunnelService -eq "cloudflared") {
    Write-Host "Starting cloudflared tunnel on port $Port..." -ForegroundColor Green
    cloudflared tunnel --url "http://localhost:$Port"
}
elseif ($TunnelService -eq "ngrok") {
    Write-Host "Starting ngrok http $Port..." -ForegroundColor Green
    ngrok http $Port
}
