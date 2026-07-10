@echo off
rem Local streaming ASR sidecar (FunASR, GPU auto-detected).
rem Default loads BOTH models; pick one in MeetingCopilot settings presets:
rem   "本地 Fun-ASR-Nano"        zh+en good, punctuation (0.8B, pseudo-stream)
rem   "本地 paraformer 流式"      zh-only, true streaming, lighter (220M)
rem Usage (optional arg to load only one model, saves RAM/VRAM):
rem   start-funasr-local.bat            -> both
rem   start-funasr-local.bat nano       -> Fun-ASR-Nano only
rem   start-funasr-local.bat paraformer -> paraformer only
rem First run downloads model(s) from ModelScope.
rem Keep this window open; MeetingCopilot backend = cloud-realtime + ws://127.0.0.1:10097
cd /d "%~dp0"
set MODEL=%1
if "%MODEL%"=="" set MODEL=both
"C:\ProgramData\miniconda3\Scripts\conda.exe" run --no-capture-output -n funasr python tools\funasr_stream_server.py --port 10097 --model %MODEL% --device auto
pause
