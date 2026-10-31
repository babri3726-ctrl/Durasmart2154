@echo off
title Dura Smart - Public Cloudflare Tunnel
echo ========================================================
echo   Starting Dura Smart Secure Public Tunnel (No VPN Needed)
echo ========================================================
echo.
echo Tunneling local FastAPI backend (http://127.0.0.1:8010) to the public internet...
echo You will see an HTTPS URL below (e.g. https://xxx.trycloudflare.com).
echo.
echo Enter that HTTPS URL in your mobile app under:
echo Settings -^> Change Server Host
echo.
echo ========================================================
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8010
pause
