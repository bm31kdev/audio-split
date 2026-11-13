# AudioSplit Studio — v1.3.2

AudioSplit Studio permet de séparer une musique directement sur votre PC, de régler chaque piste extraite, puis d’exporter votre propre mixage WAV stéréo. L’application est disponible en français et en anglais.

> [Read this guide in English →](README.en.md)

## Démarrer l’application

Téléchargez ou clonez le projet, ouvrez PowerShell dans son dossier, puis lancez cette seule commande :

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

Au premier lancement, le script fait tout automatiquement :

1. Installe Python 3.11 et FFmpeg s’ils sont absents.
2. Installe les versions de dépendances épinglées pour Windows et Python 3.11.
3. Ouvre l’application sur le port 8000, ou choisit automatiquement le premier port libre entre 8000 et 8010 si celui-ci est occupé.

Lorsque `Installation complete: OK` s’affiche, l’application est prête. Le lanceur affiche son adresse exacte ; si AudioSplit Studio tourne déjà, il ouvre cette instance. Gardez la fenêtre PowerShell ouverte pendant son utilisation. Pour arrêter le serveur, faites `Ctrl+C` dans cette fenêtre.

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

### Dossiers et projets locaux

Ouvrez **Projets** dans l’en-tête pour créer des dossiers et y enregistrer chaque séparation comme un projet. Le nom proposé reprend celui du fichier importé. Les pistes séparées et tous les réglages du mixeur (volume, panoramique, sourdine, effets et courbes) sont sauvegardés localement dans `data/library/`, sans base de données. Après le premier enregistrement, les changements sont sauvegardés automatiquement toutes les 10 secondes ; l’état apparaît en haut de la page. Vous pouvez rouvrir, renommer ou supprimer les projets et dossiers après avoir redémarré l’application. Le bouton de vidage du cache ne supprime pas cette bibliothèque.

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
- Chorus, flanger et phaser sur la voix et les pistes d’instruments.
- Trémolo sur la voix, la batterie et les instruments ; bitcrusher sur la batterie et les instruments.
- Noise gate sur la voix et la batterie ; de-esser sur la voix uniquement.
- Limiteur sur toutes les pistes et exciter sur la voix et les pistes d’instruments.

Chaque carte indique les pistes compatibles. Les réglages s’appliquent pendant l’écoute et sont inclus dans l’export WAV.

## À savoir

- Le traitement se fait entièrement sur votre PC : les musiques ne sont jamais envoyées à un service en ligne.
- Lors de la première séparation avec chaque modèle, Demucs télécharge automatiquement ses poids depuis Internet dans le cache local de PyTorch. Le téléchargement peut prendre plusieurs minutes et nécessite de l’espace disque ; une première séparation hors ligne échouera tant que le modèle n’aura pas été téléchargé.
- Les résultats de séparation suivants peuvent venir du cache AudioSplit local.
- Demucs utilise actuellement le processeur, même si une carte graphique compatible est installée.
- L’export est un WAV PCM stéréo 16 bits.
- Les imports sont limités à 512 Mio et 15 minutes. Les modes détaillés peuvent être limités à une durée plus courte selon la mémoire requise par les stems ; le cache temporaire est plafonné à 10 Gio et l’application garde une marge d’espace disque.
- La bibliothèque de projets est plafonnée à 20 Gio. Chaque projet peut être exporté en archive ZIP puis importé pour le sauvegarder ou le transférer ; gardez ces archives sur un autre disque si vous voulez protéger vos sauvegardes d’une panne du PC.
- L’export refuse un rendu estimé trop volumineux pour éviter de saturer la mémoire du navigateur. Un limiteur master et une réduction automatique des crêtes évitent l’écrêtage du WAV.
- **Vider le cache AudioSplit** supprime les séparations enregistrées et les fichiers audio temporaires de votre PC. Le mixeur actuellement ouvert reste utilisable jusqu’au rechargement de la page.
- Les manifestes de projet ont une sauvegarde locale `.bak` pour récupérer un JSON corrompu ; cela ne remplace pas une copie de sauvegarde de la bibliothèque audio.
- Pour supprimer un dossier ou un projet, l’application demande de retaper son nom exact avant d’effacer définitivement ses fichiers.

## En cas de problème

Commencez par fermer PowerShell et le navigateur, puis relancez la commande de démarrage :

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

Si `winget` est introuvable, installez **App Installer** depuis le Microsoft Store, puis relancez la commande. Le lanceur automatique prend actuellement en charge Windows uniquement.

## Structure du projet

Le projet reste volontairement simple : FastAPI exécute Demucs localement dans `app/main.py`, tandis que le mixeur Web Audio se trouve dans `app/static/`. Les séparations temporaires sont dans `data/jobs/` et `data/uploads/`. La bibliothèque durable se trouve dans `data/library/`, sous forme de dossiers, fichiers audio et manifestes JSON, sans base de données. Ces données locales ne sont pas versionnées.

- `app/static/index.html` : structure principale de l’application.
- `app/static/components/` : HTML des modals Fx, langue, bibliothèque de projets et historique des versions.
- `app/static/js/i18n.js` : dictionnaires français/anglais et sauvegarde du choix de langue.
- `app/static/js/effects/` : un module Web Audio par effet.
- `app/static/js/modal-manager.js` : chargement et cycle de vie des modals.
- `app/static/app.js` : orchestration du mixeur, de la lecture, de l’export et de l’interface multilingue.
- `requirements.txt` décrit les dépendances principales ; `requirements-windows-py311.lock` verrouille leurs dépendances indirectes avec hashes SHA-256 pour Windows/Python 3.11.

## Licence

Le code du projet est distribué sous licence [MIT](LICENSE). Les dépendances et ressources tierces restent soumises à leurs propres licences.
