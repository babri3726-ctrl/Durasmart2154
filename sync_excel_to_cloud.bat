@echo off
setlocal enabledelayedexpansion
title Dura Smart - 1-Click Excel Cloud Sync
echo ========================================================
echo     Dura Smart - 1-Click Live Excel Cloud Sync
echo ========================================================
echo.
echo Syncing OneDrive workbooks to https://durasmart2154.onrender.com...
echo.

set "ONEDRIVE_DIR=%USERPROFILE%\OneDrive"
set "STOCK_FILE=%ONEDRIVE_DIR%\1-8-26.xlsx"
set "HRPB_FILE=%ONEDRIVE_DIR%\HR-PB.xlsx"

if exist "%STOCK_FILE%" (
    echo [1/2] Syncing Stock Workbook: 1-8-26.xlsx
    curl.exe -s -X POST -F "file=@%STOCK_FILE%" "https://durasmart2154.onrender.com/api/v1/imports/excel/upload"
    echo.
) else (
    echo [1/2] Stock file not found at: %STOCK_FILE%
)

if exist "%HRPB_FILE%" (
    echo [2/2] Syncing HR-PB Targets and Dealers: HR-PB.xlsx
    curl.exe -s -X POST -F "file=@%HRPB_FILE%" "https://durasmart2154.onrender.com/api/v1/imports/excel/upload"
    echo.
) else (
    echo [2/2] HR-PB file not found at: %HRPB_FILE%
)

echo.
echo ========================================================
echo  Sync Complete! Check your live panel at:
echo  https://durasmart2154.onrender.com
echo ========================================================
echo.
pause
