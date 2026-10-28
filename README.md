# AudioSplit Studio — v1.0.2

AudioSplit Studio permet de séparer une musique directement sur votre PC, d’ajuster ses pistes et de télécharger votre propre mixage stéréo.

## Démarrer

Téléchargez ou clonez le projet, ouvrez PowerShell dans son dossier, puis lancez cette seule commande :

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

Au premier lancement, le script fait tout automatiquement :

1. Installe Python 3.11 et FFmpeg si votre PC ne les possède pas.
2. Installe les composants nécessaires à AudioSplit Studio.
3. Ouvre le site dans votre navigateur à l’adresse <http://127.0.0.1:8000>.

Quand le message `Installation complete: OK` s’affiche, c’est prêt. Gardez simplement la fenêtre PowerShell ouverte pendant que vous utilisez le site. Pour arrêter le programme, faites `Ctrl+C` dans cette fenêtre.

> Vous avez déjà lancé cette commande une fois ? Relancez exactement la même : elle vérifie ce qui est installé et ne réinstalle pas inutilement les composants déjà présents.

## Utiliser AudioSplit Studio

1. En haut de la page, choisissez le niveau de séparation souhaité.
2. Importez votre morceau (`MP3`, `WAV`, `FLAC`, `M4A` ou `OGG`).
3. Lancez la séparation, puis attendez la fin du traitement.
4. Écoutez le résultat, réglez les pistes, puis exportez le mixage WAV stéréo.

### Choisir le bon niveau de séparation

| Votre objectif | Choix à utiliser | Résultat |
| --- | --- | --- |
| Faire un karaoké ou isoler le chant | **Voix + accompagnement** | Une piste voix et une piste musique sans voix |
| Retoucher précisément un morceau | **Détaillée** | Voix, batterie/kicks, basse et autres instruments, tous réglables séparément |

Pendant la lecture, les changements de volume, panoramique G/D ou sourdine sont appliqués immédiatement : pas besoin de relancer le morceau. Chaque piste affiche aussi sa forme d’onde pour faciliter le repérage visuel.

## À savoir

- Le traitement se fait sur votre ordinateur : les musiques ne sont pas envoyées vers un service en ligne.
- La première séparation télécharge le modèle Demucs (environ 300 Mo) et peut prendre quelques minutes. Les suivantes sont plus rapides.
- Sur un PC sans carte graphique compatible, la séparation est effectuée par le processeur ; c’est normal si elle prend du temps.
- L’export est un fichier WAV PCM 16 bits stéréo.

## Si quelque chose bloque

Commencez par fermer PowerShell et le navigateur, puis relancez la commande de démarrage unique :

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

Si le message indique que `winget` est introuvable, installez **App Installer** depuis le Microsoft Store, puis relancez la commande. Si votre PC n’est pas sous Windows, le lanceur automatique n’est pas encore pris en charge.

## Pour les développeurs

Le projet est volontairement simple : FastAPI lance Demucs localement dans `app/main.py`, et l’interface de mixage Web Audio se trouve dans `app/static/`. Les fichiers temporaires générés par les séparations sont conservés localement dans `data/` et ne sont jamais versionnés.
