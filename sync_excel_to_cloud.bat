@echo off
setlocal enabledelayedexpansion
title Dura Smart - 1-Click Excel Cloud Sync
color 0b

echo ========================================================
echo       DURA SMART - 1-CLICK EXCEL CLOUD SYNC
echo ========================================================
echo.
echo Connecting to Cloud Service: https://durasmart2154.onrender.com
echo.

set "ONEDRIVE_DIR=%USERPROFILE%\OneDrive"
set "STOCK_FILE=%ONEDRIVE_DIR%\1-8-26.xlsx"
set "HRPB_FILE=%ONEDRIVE_DIR%\HR-PB.xlsx"
set "CLOUD_URL=https://durasmart2154.onrender.com/api/v1/imports/excel/upload"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$stock = [System.IO.Path]::Combine($env:USERPROFILE, 'OneDrive', '1-8-26.xlsx');" ^
    "$hrpb = [System.IO.Path]::Combine($env:USERPROFILE, 'OneDrive', 'HR-PB.xlsx');" ^
    "$url = 'https://durasmart2154.onrender.com/api/v1/imports/excel/upload';" ^
    "if (Test-Path $stock) {" ^
    "    Write-Host '[1/2] Syncing Stock: 1-8-26.xlsx (handling active Excel lock)...' -ForegroundColor Cyan;" ^
    "    $tmpStock = [System.IO.Path]::Combine($env:TEMP, 'sync_upload_stock.xlsx');" ^
    "    Copy-Item -Path $stock -Destination $tmpStock -Force;" ^
    "    $resp = curl.exe -s -X POST -F ('file=@' + $tmpStock + ';filename=1-8-26.xlsx') $url;" ^
    "    Remove-Item $tmpStock -Force -ErrorAction SilentlyContinue;" ^
    "    try {" ^
    "        $json = $resp | ConvertFrom-Json;" ^
    "        if ($json.status -eq 'success') {" ^
    "            Write-Host ('   SUCCESS: ' + $json.result.items_parsed + ' stock items parsed and live on cloud!') -ForegroundColor Green;" ^
    "        } else {" ^
    "            Write-Host ('   NOTE: ' + $resp) -ForegroundColor Yellow;" ^
    "        }" ^
    "    } catch {" ^
    "        Write-Host ('   RESPONSE: ' + $resp);" ^
    "    }" ^
    "} else {" ^
    "    Write-Host '[1/2] Stock file not found at: ' $stock -ForegroundColor Red;" ^
    "};" ^
    "if (Test-Path $hrpb) {" ^
    "    Write-Host '[2/2] Syncing Targets: HR-PB.xlsx (handling active Excel lock)...' -ForegroundColor Cyan;" ^
    "    $tmpHrpb = [System.IO.Path]::Combine($env:TEMP, 'sync_upload_hrpb.xlsx');" ^
    "    Copy-Item -Path $hrpb -Destination $tmpHrpb -Force;" ^
    "    $resp = curl.exe -s -X POST -F ('file=@' + $tmpHrpb + ';filename=HR-PB.xlsx') $url;" ^
    "    Remove-Item $tmpHrpb -Force -ErrorAction SilentlyContinue;" ^
    "    try {" ^
    "        $json = $resp | ConvertFrom-Json;" ^
    "        if ($json.status -eq 'success') {" ^
    "            Write-Host ('   SUCCESS: ' + $json.result.targets_parsed + ' targets ^& ' + $json.result.dealers_count + ' dealers synced!') -ForegroundColor Green;" ^
    "        } else {" ^
    "            Write-Host ('   NOTE: ' + $resp) -ForegroundColor Yellow;" ^
    "        }" ^
    "    } catch {" ^
    "        Write-Host ('   RESPONSE: ' + $resp);" ^
    "    }" ^
    "} else {" ^
    "    Write-Host '[2/2] HR-PB file not found at: ' $hrpb -ForegroundColor Red;" ^
    "}"

echo.
echo ========================================================
echo  Sync Process Complete!
echo  View your live cockpit at:
echo  https://durasmart2154.onrender.com
echo ========================================================
echo.
pause
