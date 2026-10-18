@echo off
pushd "%~dp0"
if errorlevel 1 (
    echo Could not open the SillyTavern folder.
    pause
    exit /b 1
)
git --version > nul 2>&1
if errorlevel 1 (
    echo [91mGit is not installed on this system.[0m
    echo Install it from https://git-scm.com/downloads
    goto end
)
if not exist .git (
    echo [91mNot running from a Git repository. Reinstall using an officially supported method to get updates.[0m
    echo See: https://docs.sillytavern.app/installation/windows/
    goto end
)
git symbolic-ref --quiet HEAD > nul 2>&1
if errorlevel 1 (
    echo Git is not currently on a branch. The update and server start have stopped.
    echo Run "git status" in this folder to check for an unfinished operation.
    echo ChloLirium updates are on the staging branch.
    goto end
)
call git pull --rebase --autostash
if errorlevel 1 (
    echo [91mThere were errors while updating. The server has not been started.[0m
    echo See the update FAQ at https://docs.sillytavern.app/installation/updating/
    goto end
)
set NODE_ENV=production
call npm install --no-save --no-audit --no-fund --loglevel=error --no-progress --omit=dev --ignore-scripts
if errorlevel 1 (
    echo There were errors while installing dependencies. The server has not been started.
    goto end
)
node server.js %*
:end
pause
popd
