# AudioSplit Studio

**Séparez une musique, façonnez chaque piste et exportez un mix stéréo — directement sur votre PC.**

[Lire la version anglaise](README.en.md)

## Démarrer

Téléchargez le dépôt, ouvrez PowerShell dans le dossier du projet et lancez :

```powershell
powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
```

Au premier lancement, le script installe Python 3.11, FFmpeg et les dépendances nécessaires s’ils manquent, puis ouvre AudioSplit Studio dans le navigateur. Il affiche l’adresse locale utilisée. Gardez la fenêtre PowerShell ouverte pendant l’utilisation ; `Ctrl+C` arrête le serveur.

Relancez la même commande pour ouvrir l’application plus tard. Le script vérifie l’installation existante et évite de réinstaller les dépendances si elles n’ont pas changé. Il choisit un port libre entre 8000 et 8010 si le port habituel est occupé.

> Le lanceur automatique est prévu pour Windows et utilise `winget`. Si `winget` est absent, installez **App Installer** depuis le Microsoft Store. Une connexion Internet est nécessaire à l’installation et au premier téléchargement des modèles Demucs.

## Faire un mix

1. Sur **Accueil**, choisissez le type de séparation et importez un fichier MP3, WAV, FLAC, M4A ou OGG.
2. Lancez le traitement local. Le mode simple produit la voix et l’accompagnement ; le mode détaillé sépare aussi batterie, basse et autres instruments.
3. Dans **Studio**, écoutez les pistes et ajustez leur volume, panoramique, sourdine ou Solo. Les changements s’entendent immédiatement.
4. Exportez le résultat en WAV stéréo.

Les courbes permettent d’automatiser le volume, le panoramique et les effets dans le temps : ajoutez ou déplacez des points avec la souris. Le bouton **Fx** de chaque piste ouvre les effets disponibles pour cette piste, comme l’égaliseur, le compresseur, la réverbération, le delay ou les effets de basse. Les réglages sont inclus dans l’écoute, les projets et l’export.

AudioSplit analyse aussi le tempo et la tonalité du morceau. Dans le Studio, vous pouvez préécouter puis appliquer un changement de tempo ou de tonalité au mix. La voix et la batterie séparée sont préservées lors de la transposition.

Le bouton globe en haut à droite permet de passer l’application du français à l’anglais.

## Projets et fichiers

Dans **Projets**, créez des dossiers et enregistrez vos séparations sous forme de projets. Un projet conserve les pistes et les réglages du mix ; après le premier enregistrement, il est sauvegardé automatiquement toutes les 10 secondes. Vous pouvez aussi enregistrer des préréglages de mix, puis les exporter ou les importer.

Tout reste sur cet ordinateur, sans base de données ni envoi de vos musiques à un service en ligne :

- Les projets et préréglages sont dans `data/library/` et restent disponibles après redémarrage.
- Les séparations calculées et copies temporaires sont dans `data/jobs/` et `data/uploads/`.
- **Vider le cache AudioSplit** supprime les données temporaires, pas la bibliothèque de projets.

## À savoir

- Demucs fonctionne actuellement sur le processeur. Le premier traitement télécharge les poids du modèle ; les suivants peuvent réutiliser le cache local.
- Un fichier peut peser jusqu’à **512 Mio** et durer jusqu’à **15 minutes**. Le mode détaillé et l’export peuvent demander beaucoup de mémoire ; l’application bloque les rendus qui dépasseraient ses limites de sécurité.
- Le cache temporaire est limité à **10 Gio** et la bibliothèque de projets à **20 Gio**.
- L’export est un WAV stéréo PCM 16 bits.

## Si le démarrage échoue

Relancez la commande d’installation ci-dessus : elle vérifie l’environnement et peut réparer les dépendances. Si l’erreur indique que `winget` est introuvable, installez **App Installer**. Si tous les ports 8000 à 8010 sont occupés, fermez l’autre instance ou l’application qui les utilise, puis réessayez.

## Pour contribuer

Le serveur est écrit en Python avec FastAPI ; Demucs réalise la séparation. L’interface et le mixeur Web Audio sont dans `app/static/`. Les routes, la bibliothèque locale et les préréglages sont organisés en modules sous `app/`. Il n’y a pas de base de données.

Le lanceur Windows utilise Python 3.11 et le fichier `requirements-windows-py311.lock` pour installer des dépendances verrouillées. Les dépendances directes sont listées dans `requirements.txt`.

## Licence

Le code du projet est sous licence [MIT](LICENSE). Les dépendances tierces conservent leurs licences respectives.
