# AudioSplit Studio

**Separate a song, shape every stem, and export a stereo mix — right on your PC.**

[Lire la version française](README.md)

## Get started

Download the repository, open PowerShell in the project folder, and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

On the first run, the script installs Python 3.11, FFmpeg, and the required packages if needed, then opens AudioSplit Studio in your browser. It prints the local address it uses. Keep the PowerShell window open while the app is running; press `Ctrl+C` to stop the server.

Run the same command next time. It checks the existing setup and skips reinstalling dependencies when nothing has changed. If the usual port is busy, it selects an available port from 8000 to 8010.

> The automatic launcher is for Windows and uses `winget`. If `winget` is unavailable, install **App Installer** from the Microsoft Store. Internet access is needed for setup and the first Demucs model download.

## Make a mix

1. On **Home**, choose a separation mode and import an MP3, WAV, FLAC, M4A, or OGG file.
2. Start local processing. Simple mode produces vocals and accompaniment; detailed mode also separates drums, bass, and other instruments.
3. In **Studio**, listen to the stems and adjust each track’s volume, pan, mute, or Solo. Changes are heard immediately.
4. Export the result as a stereo WAV file.

Use the curves to automate volume, pan, and effects over time: add or drag points with the mouse. Each track’s **Fx** button opens the effects available for that track, such as EQ, compression, reverb, delay, or bass processing. These settings are included in playback, projects, and exports.

AudioSplit also analyzes a song’s tempo and key. In Studio, preview and apply tempo or key changes to the mix. Vocals and separately split drums are preserved during transposition.

Use the globe button in the top-right corner to switch the app between English and French.

## Projects and files

In **Projects**, create folders and save separations as projects. A project keeps the stems and mix settings; after the first save, changes are saved automatically every 10 seconds. You can also save mix presets and export or import them.

Everything stays on this computer, with no database and no upload of your music to an online service:

- Projects and presets are in `data/library/` and remain available after restarting the app.
- Generated separations and temporary audio copies are in `data/jobs/` and `data/uploads/`.
- **Clear AudioSplit cache** removes temporary data, not the project library.

## Good to know

- Demucs currently runs on the CPU. The first separation downloads model weights; later runs may reuse the local cache.
- Files can be up to **512 MiB** and **15 minutes** long. Detailed separation and export can require substantial memory; the app blocks renders that exceed its safety limits.
- The temporary cache is limited to **10 GiB** and the project library to **20 GiB**.
- Exports are 16-bit PCM stereo WAV files.

## If startup fails

Run the setup command above again: it checks the environment and can repair dependencies. If PowerShell cannot find `winget`, install **App Installer**. If every port from 8000 to 8010 is occupied, close the other AudioSplit instance or the application using those ports, then try again.

## Contributing

The server uses Python and FastAPI; Demucs handles source separation. The interface and Web Audio mixer are in `app/static/`. API routes, the local project library, and presets are split into modules under `app/`. The app does not use a database.

The Windows launcher uses Python 3.11 and `requirements-windows-py311.lock` for pinned dependencies. Direct dependencies are listed in `requirements.txt`.

## License

The project code is licensed under [MIT](LICENSE). Third-party dependencies retain their respective licenses.
