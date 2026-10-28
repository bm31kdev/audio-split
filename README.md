# AudioSplit Studio — v1.0

Application locale Windows de séparation et de mixage audio. Importez un morceau, laissez **Demucs** (open source) isoler ses stems, puis ajustez et exportez votre mixage en WAV stéréo.

## Fonctionnalités

- Import : MP3, WAV, FLAC, M4A et OGG.
- Deux modes de séparation : **voix + accompagnement** ou **détaillé** (voix, batterie/kicks, basse, autres instruments).
- Traitement entièrement local : les fichiers ne sont pas envoyés vers un service externe.
- Forme d’onde, sourdine, volume et panoramique G/D indépendants pour chaque stem.
- Réglages appliqués instantanément pendant l’écoute.
- Export du mixage final en WAV PCM 16 bits stéréo.

## Prérequis

- Windows 10/11
- [Python 3.11 64 bits](https://www.python.org/downloads/release/python-3119/) (cocher **Add Python to PATH**)
- FFmpeg *Shared*, requis par Demucs pour les MP3. Installation : `winget install --id Gyan.FFmpeg.Shared --exact`

> Demucs fonctionne sur CPU, mais la première séparation peut prendre plusieurs minutes. Avec une carte NVIDIA et PyTorch CUDA installé, elle est beaucoup plus rapide.

## Installation

Dans PowerShell, depuis ce dossier :

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Ajoutez ensuite le dossier `bin` de FFmpeg au `PATH` de la fenêtre PowerShell, en adaptant la version si nécessaire :

```powershell
$env:Path += ";$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build-shared\bin"
ffmpeg -version
```

La dernière commande doit afficher la version de FFmpeg. Gardez cette fenêtre ouverte tant que le serveur est lancé.

## Lancement

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Ouvrez ensuite <http://127.0.0.1:8000>. Au premier lancement, Demucs télécharge ses poids (~300 Mo) dans le cache utilisateur.

Pour arrêter le serveur : `Ctrl+C`.

Si une première installation a déjà installé une version plus récente de PyTorch/Torchaudio, réinstallez les versions prévues :

```powershell
pip uninstall -y torch torchaudio torchcodec
pip install -r requirements.txt
```

## Utilisation

1. Choisissez le type de séparation avant l’import :
   - **Voix + accompagnement** crée deux pistes, idéal pour un karaoké ou un a cappella.
   - **Détaillée** crée quatre pistes : voix, batterie/kicks, basse et autres instruments.
2. Importez le morceau, puis lancez la séparation.
3. Réglez les stems avec le volume, le fader panoramique vertical G/D et le bouton de sourdine. Les changements s’entendent immédiatement pendant la lecture.
4. Cliquez sur **Exporter le mixage WAV stéréo** pour télécharger le rendu.

## Dépannage

| Symptôme | Solution |
| --- | --- |
| `py -3.11` est introuvable | Installez Python 3.11 avec `winget install --id Python.Python.3.11 --exact`, puis rouvrez PowerShell. |
| `ffmpeg` n’est pas reconnu | Exécutez la commande d’ajout du `PATH` ci-dessus, ou rouvrez complètement le terminal après l’installation Winget. |
| Demucs ne peut pas écrire les WAV | Exécutez `pip install -r requirements.txt` : le backend `soundfile` est inclus. |
| La séparation est lente | C’est normal sur CPU. Une musique de 3 minutes peut prendre plusieurs minutes ; la première utilisation télécharge aussi le modèle. |

## Architecture

- `app/main.py` : API FastAPI, stockage temporaire et lancement local de `python -m demucs`.
- `app/static/` : interface HTML/CSS/JavaScript et moteur de pré-écoute/export via Web Audio API.
- `data/` : fichiers importés et stems temporaires, ignorés par Git.

La sortie est un WAV PCM 16 bits stéréo. Le mode simple utilise `--two-stems vocals`; le mode détaillé utilise les quatre stems natifs de Demucs.

Sous Windows, `soundfile` est installé avec le projet afin que Demucs puisse écrire les stems WAV.

