@echo off
setlocal
if exist "%~dp0..\blink-kb-runtime\python\python.exe" goto portable
if exist "%~dp0.venv\Scripts\python.exe" goto venv
if defined BLINK_PYTHON goto custom
where py.exe >nul 2>&1
if not errorlevel 1 goto launcher
where python.exe >nul 2>&1
if not errorlevel 1 goto python
echo Windows x64 Python 3.12 is required. Extract the blink-kb-runtime folder next to blink-kb. 1>&2
exit /b 1
:portable
"%~dp0..\blink-kb-runtime\python\python.exe" -I -X utf8 "%~dp0launch-kb.py" %*
exit /b %errorlevel%
:venv
"%~dp0.venv\Scripts\python.exe" -I -X utf8 "%~dp0launch-kb.py" %*
exit /b %errorlevel%
:custom
"%BLINK_PYTHON%" -I -X utf8 "%~dp0launch-kb.py" %*
exit /b %errorlevel%
:launcher
py -3.12 -I -X utf8 "%~dp0launch-kb.py" %*
exit /b %errorlevel%
:python
python -I -X utf8 "%~dp0launch-kb.py" %*
exit /b %errorlevel%
