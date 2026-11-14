# AudioSplit Studio — v1.3.6

AudioSplit Studio separates a song directly on your Windows PC, lets you mix every extracted stem, and exports your own stereo WAV mix. The application is available in French and English.

> [Lire ce guide en français →](README.md)
>
> [Roadmap to V2 (French) →](ROADMAP_V2.md)

## Start the application

Download or clone this repository, open PowerShell inside the project folder, then run this single command:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

On the first run, the launcher does everything automatically:

1. Installs Python 3.11 and FFmpeg if they are missing.
2. Installs the pinned dependency versions for Windows and Python 3.11.
3. Opens the app on port 8000, or automatically selects the first free port from 8000 to 8010 if that port is busy.

When `Installation complete: OK` appears, the app is ready. The launcher prints the exact URL; if AudioSplit Studio is already running, it opens that instance. Keep the PowerShell window open while using AudioSplit Studio. Press `Ctrl+C` in that window to stop the server.

> Already ran the command once? Run the exact same command again. It checks the existing setup and does not reinstall packages unnecessarily.

After setup, you can also start the server manually with `powershell -ExecutionPolicy Bypass -File .\start.ps1`. This launcher opens an existing instance or selects a free port from 8000 to 8010.

## Use AudioSplit Studio

1. Pick a separation mode at the top of the page.
2. Import an `MP3`, `WAV`, `FLAC`, `M4A`, or `OGG` file.
3. Start local separation and wait for it to finish.
4. Play the result, adjust tracks and effects, then export a stereo WAV mix.

### Local folders and projects

Open **Projects** in the header to create folders and save each separation as a project. The suggested project name comes from the imported filename. Separated tracks and all mixer settings (volume, pan, mute, effects, and automation curves) are stored locally in `data/library/`, with no database. After the first save, changes are autosaved every 10 seconds; the status appears at the top of the page. You can reopen, rename, or delete projects and folders after restarting the app. The cache-clearing button does not delete this library.

### Pick the right separation mode

| Goal | Mode | Result |
| --- | --- | --- |
| Make karaoke or isolate singing | **Vocals + accompaniment** | Vocal stem and music-without-vocals stem |
| Edit a song precisely | **Detailed** | Vocals, drums/kicks, bass, and other instruments as separate tracks |

During playback, volume, left/right pan, mute, automation, and effect changes are applied immediately. Every track includes a waveform with time markers and pan automation points.

## Language

Use the small globe button in the top-right corner of the application to choose **Français** or **English**. The selection is saved in your browser and also applies to application messages.

## Effects

The Fx button beside each track gives access to context-appropriate effects:

- 3-band EQ and high/low-pass filters on every track.
- Compressor on vocals and bass.
- Reverb and delay on vocals.
- Stereo width on accompaniment or instruments.
- Vocal ducking on non-vocal tracks.
- Bass boost on the Bass track: a linear low-frequency filter without saturation.
- Bass saturation on bass, or on accompaniment in simple mode.
- Chorus, flanger, and phaser on vocals and instrument tracks.
- Tremolo on vocals, drums, and instruments; bitcrusher on drums and instruments.
- Noise gate on vocals and drums; de-esser on vocals only.
- Limiter on every track and exciter on vocals and instrument tracks.

Every card shows which tracks support the effect. Adjustments apply during playback and are included in the WAV export.

## Notes

- Processing happens entirely on your PC. Music files are never sent to an online service.
- The first separation with each model makes Demucs download its weights from the internet into PyTorch's local cache. This may take several minutes and requires disk space; an offline first run fails until the model has been downloaded.
- Later separation results may be loaded from AudioSplit's local cache.
- Demucs currently uses the CPU, even when a compatible GPU is installed.
- The export is a 16-bit PCM stereo WAV file.
- Imports are limited to 512 MiB and 15 minutes. Detailed mode may allow a shorter duration depending on the memory required by its stems; the temporary cache is capped at 10 GiB and the app preserves a free-disk reserve.
- The project library is capped at 20 GiB. Each project can be exported as a ZIP archive and imported later to back it up or move it; keep those archives on another drive to protect them from a PC disk failure.
- Exports estimated to exceed the browser memory budget are rejected before rendering. A master limiter and automatic peak reduction protect the WAV from clipping.
- **Clear AudioSplit cache** removes cached separations and temporary uploaded audio files from your PC. Your currently open mixer remains available until the page is reloaded.
- Project manifest JSON files have a local `.bak` recovery copy. This does not replace a backup of the audio library itself.
- Deleting a folder or project requires typing its exact name before its files are permanently removed.

## Troubleshooting

First, close PowerShell and the browser, then run the same startup command again:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

If `winget` is unavailable, install **App Installer** from the Microsoft Store and try again. The automatic launcher currently supports Windows only.

## Project structure

The project intentionally stays simple: FastAPI runs Demucs locally in `app/main.py`, while the Web Audio mixer lives in `app/static/`. Temporary separations live in `data/jobs/` and `data/uploads/`. The persistent library lives in `data/library/` as folders, audio files, and JSON manifests, with no database. Local data is not versioned.

- `app/static/index.html`: application shell.
- `app/static/components/`: Fx, language, project-library, and version-history modal HTML.
- `app/static/js/i18n.js`: French/English UI dictionary and language persistence.
- `app/static/js/audio-engine.js` and `track-state.js`: audio engine and mixer control state.
- `app/static/js/effects/`: one Web Audio module per effect, including linear bass boost.
- `app/static/js/modal-manager.js`: loading and lifecycle for modal components.
- `app/static/app.js`: mixer orchestration, playback, export, and language-aware UI.
- `requirements.txt` lists direct dependencies; `requirements-windows-py311.lock` pins transitive dependencies with SHA-256 hashes for Windows/Python 3.11.

- `app/static/components/button.html` and `button-component.js`: reusable button template and shared visual variants.

## License

The project code is distributed under the [MIT License](LICENSE). Third-party dependencies and resources remain subject to their own licenses.
