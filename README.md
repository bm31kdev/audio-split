# AudioSplit Studio — v1.2.1

AudioSplit Studio permet de séparer une musique directement sur votre PC, de régler chaque piste extraite, puis d’exporter votre propre mixage WAV stéréo. L’application est disponible en français et en anglais.

> [Read this guide in English →](README.en.md)

## Démarrer l’application

Téléchargez ou clonez le projet, ouvrez PowerShell dans son dossier, puis lancez cette seule commande :

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

Au premier lancement, le script fait tout automatiquement :

1. Installe Python 3.11 et FFmpeg s’ils sont absents.
2. Installe les dépendances d’AudioSplit Studio.
3. Ouvre l’application à l’adresse <http://127.0.0.1:8000>.

Lorsque `Installation complete: OK` s’affiche, l’application est prête. Gardez la fenêtre PowerShell ouverte pendant son utilisation. Pour arrêter le serveur, faites `Ctrl+C` dans cette fenêtre.

> Vous avez déjà utilisé cette commande ? Relancez exactement la même. Elle vérifie l’installation existante et ne réinstalle pas inutilement les paquets.

## Utiliser AudioSplit Studio

1. Choisissez un type de séparation en haut de la page.
2. Importez un fichier `MP3`, `WAV`, `FLAC`, `M4A` ou `OGG`.
3. Lancez la séparation locale et attendez sa fin.
4. Écoutez le résultat, réglez les pistes et les effets, puis exportez un WAV stéréo.

### Choisir le bon type de séparation

| Votre objectif | Mode | Résultat |
| --- | --- | --- |
| Faire un karaoké ou isoler le chant | **Voix + accompagnement** | Une piste voix et une piste musique sans voix |
| Retoucher précisément un morceau | **Détaillée** | Voix, batterie/kicks, basse et autres instruments séparés |

Pendant la lecture, les réglages de volume, panoramique, sourdine, automatisation et effets sont appliqués immédiatement. Chaque piste possède une forme d’onde avec repères temporels et points d’automatisation du panoramique.

## Changer la langue

Utilisez le petit bouton globe en haut à droite de l’application pour choisir **Français** ou **English**. Le choix est enregistré dans votre navigateur et s’applique aussi aux messages de l’application.

## Effets

Le bouton **Fx** à côté de chaque piste affiche les effets pertinents :

- Égaliseur 3 bandes et filtres passe-haut/passe-bas sur toutes les pistes.
- Compresseur sur la voix et la basse.
- Reverb et delay sur la voix.
- Largeur stéréo sur l’accompagnement ou les instruments.
- Ducking voix sur les pistes non vocales.
- Saturation basse sur la basse, ou sur l’accompagnement en mode simple.

## À savoir

- Le traitement se fait entièrement sur votre PC : les musiques ne sont jamais envoyées à un service en ligne.
- La première utilisation d’un modèle Demucs peut prendre quelques minutes ; les résultats suivants peuvent venir du cache local.
- Sans carte graphique compatible, Demucs utilise le processeur.
- L’export est un WAV PCM stéréo 16 bits.
- **Vider le cache AudioSplit** supprime les séparations enregistrées et les fichiers audio temporaires de votre PC. Le mixeur actuellement ouvert reste utilisable jusqu’au rechargement de la page.

## En cas de problème

Commencez par fermer PowerShell et le navigateur, puis relancez la commande de démarrage :

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

Si `winget` est introuvable, installez **App Installer** depuis le Microsoft Store, puis relancez la commande. Le lanceur automatique prend actuellement en charge Windows uniquement.

## Structure du projet

Le projet reste volontairement simple : FastAPI exécute Demucs localement dans `app/main.py`, tandis que le mixeur Web Audio se trouve dans `app/static/`. Les données temporaires sont enregistrées localement dans `data/` et ne sont pas versionnées.

- `app/static/index.html` : structure principale de l’application.
- `app/static/components/` : HTML des modals Fx, langue et historique des versions.
- `app/static/js/i18n.js` : dictionnaires français/anglais et sauvegarde du choix de langue.
- `app/static/js/effects/` : un module Web Audio par effet.
- `app/static/js/modal-manager.js` : chargement et cycle de vie des modals.
- `app/static/app.js` : orchestration du mixeur, de la lecture, de l’export et de l’interface multilingue.
