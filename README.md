# AudioSplit Studio — v1.2

AudioSplit Studio separates a song directly on your Windows PC, lets you mix every extracted stem, and exports your own stereo WAV mix. The application is available in French and English.

## Start the application

Download or clone this repository, open PowerShell inside the project folder, then run this single command:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

On the first run, the launcher does everything automatically:

1. Installs Python 3.11 and FFmpeg if they are missing.
2. Installs AudioSplit Studio dependencies.
3. Opens the app at <http://127.0.0.1:8000>.

When `Installation complete: OK` appears, the app is ready. Keep the PowerShell window open while using AudioSplit Studio. Press `Ctrl+C` in that window to stop the server.

> Already ran the command once? Run the exact same command again. It checks the existing setup and does not reinstall packages unnecessarily.

## Use AudioSplit Studio

1. Pick a separation mode at the top of the page.
2. Import an `MP3`, `WAV`, `FLAC`, `M4A`, or `OGG` file.
3. Start separation and wait for the local process to finish.
4. Play the result, adjust tracks and effects, then export a stereo WAV mix.

### Pick the right separation mode

| Goal | Mode | Result |
| --- | --- | --- |
| Make karaoke or isolate singing | **Vocals + accompaniment** | Vocal stem and music-without-vocals stem |
| Edit a song precisely | **Detailed** | Vocals, drums/kicks, bass, and other instruments as separate tracks |

During playback, volume, left/right pan, mute, automation, and effect changes are applied immediately. Every track includes a waveform with time markers and pan automation points.

## Language

Use the small globe button in the top-right corner of the application to choose **Français** or **English**. The selection is saved in your browser.

## Effects

The Fx button beside each track gives access to context-appropriate effects:

- 3-band EQ and high/low-pass filters on every track.
- Compressor on vocals and bass.
- Reverb and delay on vocals.
- Stereo width on accompaniment or instruments.
- Vocal ducking on non-vocal tracks.
- Bass saturation on bass, or on accompaniment in simple mode.

## Notes

- Processing happens entirely on your PC. Music files are never sent to an online service.
- The first run downloads the selected Demucs model and can take a few minutes. Later separations can be loaded from the local cache.
- On a PC without a compatible GPU, Demucs uses the CPU.
- The export is a 16-bit PCM stereo WAV file.
- **Clear AudioSplit cache** removes cached separations and temporary uploaded audio files from your PC. Your currently open mixer remains available until the page is reloaded.

## Troubleshooting

First, close PowerShell and the browser, then run the same startup command again:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

If `winget` is unavailable, install **App Installer** from the Microsoft Store and try again. The automatic launcher currently supports Windows only.

## Project structure

The project intentionally stays simple: FastAPI runs Demucs locally in `app/main.py`, while the Web Audio mixer lives in `app/static/`. Temporary separation data is stored locally in `data/` and is not versioned.

- `app/static/index.html`: application shell.
- `app/static/components/`: Fx, language, and version-history modal HTML.
- `app/static/js/i18n.js`: French/English UI dictionary and language persistence.
- `app/static/js/effects/`: one Web Audio module per effect.
- `app/static/js/modal-manager.js`: loading and lifecycle for modal components.
- `app/static/app.js`: mixer orchestration, playback, export, and language-aware UI.
