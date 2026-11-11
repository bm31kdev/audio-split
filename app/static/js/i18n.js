// UI strings live in one place so French and English always evolve together.

const messages = {
  fr: {
    'app.tagline': 'Séparez. Mixez. Exportez.', 'app.local': '● Traitement local',
    'hero.eyebrow': 'STUDIO DE STEMS', 'hero.title': 'Redonnez de l’espace<br>à votre musique.', 'hero.description': 'Extrayez la voix, ajustez chaque piste et créez votre version stéréo.',
    'import.title': 'Importez votre morceau', 'import.formats': 'MP3, WAV, FLAC, M4A ou OGG', 'split.type': 'Type de séparation', 'split.simple': 'Voix + accompagnement', 'split.detailed': 'Détaillée : voix, batterie, basse, instruments',
    'speed.title': 'Vitesse de séparation', 'speed.fast': 'Rapide — recommandé sur CPU', 'speed.studio': 'Studio — meilleure précision, plus lent', 'file.choose': 'Choisir un fichier', 'file.separate': 'Séparer la voix et l’accompagnement',
    'cache.clear': 'Vider le cache AudioSplit', 'cache.title': 'Supprimer les séparations et fichiers audio mis en cache sur ce PC', 'cache.confirm': 'Vider le cache AudioSplit ?\n\nCela supprimera de ce PC :\n• les séparations déjà calculées (voix, accompagnement, batterie, basse, instruments) ;\n• les copies temporaires des musiques importées.\n\nLes fichiers audio originaux et vos réglages ne seront pas supprimés.',
    'mixer.eyebrow': 'MIXAGE', 'mixer.title': 'Vos pistes', 'play.title': 'Écouter le mix', 'pause.title': 'Mettre la lecture en pause', 'resume.title': 'Reprendre la lecture', 'stop.title': 'Arrêter', 'export': '↓ Exporter le mixage WAV stéréo',
    'version.title': 'Voir l’historique des versions', 'language.trigger': 'FR', 'language.triggerTitle': 'Changer la langue',
    'language.eyebrow': 'LANGUE', 'language.heading': 'Choisir la langue', 'language.description': 'Choisissez la langue de l’interface.', 'language.french': 'Français', 'language.english': 'English', 'close': 'Fermer',
    'changelog.eyebrow': 'AUDIO SPLIT STUDIO', 'changelog.heading': 'Historique des versions', 'changelog.description': 'Les nouveautés du studio, de la première version à aujourd’hui.', 'current': 'Actuelle',
    'release.1.3': 'Bibliothèque locale de projets, sauvegarde automatique toutes les 10 secondes, reprise de lecture et curseur commun déplaçable sur toutes les pistes.',
    'release.1.2.3': 'Cache plus sûr : bouton déplacé, confirmation détaillée avant suppression des fichiers temporaires.', 'release.1.2.2': 'Historique enrichi : date et heure de commit affichées pour chaque version.', 'release.1.2.1': 'Documentation française et anglaise distincte avec des liens réciproques.', 'release.1.2': 'Interface bilingue français/anglais, sélecteur de langue et documentation GitHub en anglais.', 'release.1.1.7': 'Cache local vidable, lecture/pause fiabilisée, icônes synchronisées et barre de lecture réparée.',
    'release.1.1.6': 'Suite d’effets complète : compresseur, EQ, reverb, delay, filtres, width et ducking voix.', 'release.1.1.5': 'Saturation basse plus granuleuse et contrôle vertical intégré à sa carte.', 'release.1.1.4': 'Architecture front-end séparée : composants, styles et modules dédiés.',
    'release.1.1.3': 'Saturation basse réglable dans Fx et historique sans défilement interne.', 'release.1.1.2': 'Ajout de l’historique des versions directement dans l’application.', 'release.1.1.1': 'Modèle rapide Windows corrigé, bouton Fx prêt pour les effets et tête de lecture animée sur les courbes.',
    'release.1.1.0': 'Automatisation du panoramique sur toutes les pistes, courbes fluides, repères temporels et cache local accéléré.', 'release.1.0.4': 'Intégration des logos AudioSplit Studio dans l’interface et le favicon.', 'release.1.0.3': 'Console de mixage améliorée : contrôles volume/panoramique en jauges et interface visuelle affinée.',
    'release.1.0.2': 'Guide de démarrage réécrit pour rendre l’installation plus simple et intuitive.', 'release.1.0.1': 'Ajout du lancement automatique : installation des dépendances et ouverture de l’application en une commande.', 'release.1.0.0': 'Première version : import audio, séparation locale Demucs, mixage stéréo et export WAV.',
    'release.date.1.2.3': '11 nov. 2026 · 11:12', 'release.date.1.2.2': '11 nov. 2026 · 10:45', 'release.date.1.2.1': '29 oct. 2026 · 10:30', 'release.date.1.2': '29 oct. 2026 · 10:28', 'release.date.1.1.7': '29 oct. 2026 · 10:11', 'release.date.1.1.6': '29 oct. 2026 · 10:00', 'release.date.1.1.5': '29 oct. 2026 · 10:00', 'release.date.1.1.4': '29 oct. 2026 · 10:00', 'release.date.1.1.3': '28 oct. 2026 · 18:23', 'release.date.1.1.2': '28 oct. 2026 · 18:19', 'release.date.1.1.1': '28 oct. 2026 · 18:17', 'release.date.1.1.0': '28 oct. 2026 · 09:48', 'release.date.1.0.4': '28 oct. 2026 · 09:20', 'release.date.1.0.3': '28 oct. 2026 · 09:15', 'release.date.1.0.2': '28 oct. 2026 · 08:44', 'release.date.1.0.1': '28 oct. 2026 · 08:43', 'release.date.1.0.0': '28 oct. 2026 · 08:39',
    'fx.eyebrow': 'EFFETS', 'fx.close': 'Fermer les effets', 'fx.title': 'Fx — {track}', 'fx.description': 'Réglez les effets de cette piste pendant l’écoute.', 'fx.done': 'Fermer', 'fx.eq.title': 'Égaliseur 3 bandes', 'fx.eq.description': 'Ajustez rapidement la couleur de la piste.', 'fx.low': 'Graves', 'fx.mid': 'Médiums', 'fx.high': 'Aigus',
    'fx.filters.title': 'Filtres', 'fx.filters.description': 'Retirez les graves ou les aigus rapidement.', 'fx.highPass': 'Passe-haut', 'fx.lowPass': 'Passe-bas', 'fx.compressor.title': 'Compresseur', 'fx.compressor.description': 'Stabilise les écarts de niveau.', 'fx.compression': 'Compression',
    'fx.reverb.title': 'Reverb', 'fx.reverb.description': 'Ajoute de l’espace à la voix.', 'fx.delay.title': 'Delay', 'fx.delay.description': 'Ajoute un écho rythmique à la voix.', 'fx.mix': 'Mix', 'fx.width.title': 'Stéréo width', 'fx.width.description': '100 garde la largeur originale.', 'fx.width': 'Largeur',
    'fx.duck.title': 'Ducking voix', 'fx.duck.description': 'Baisse cette piste lorsque la voix chante.', 'fx.duck': 'Ducking', 'fx.bass.label': 'EFFET BASSE', 'fx.bass.title': 'Saturation basse', 'fx.bass.description': 'Ajoute du grain aux graves sans monter le volume.',
    'fx.empty.title': 'Aucun effet sur cette piste', 'fx.empty.description': 'La saturation basse est disponible uniquement sur {track} pour cette séparation.',
    'stem.vocals': 'Voix', 'stem.vocalsDetail': 'Stem vocal extrait', 'stem.accompaniment': 'Accompagnement', 'stem.accompanimentDetail': 'Musique sans voix', 'stem.drums': 'Batterie & kicks', 'stem.drumsDetail': 'Batterie, percussions et kicks', 'stem.bass': 'Basse', 'stem.bassDetail': 'Bassline extraite', 'stem.other': 'Instruments', 'stem.otherDetail': 'Autres instruments et nappes',
    'automation.pan': 'Pan {track}', 'automation.left': 'Gauche', 'automation.center': 'Centre', 'automation.right': 'Droite', 'automation.remove': 'Supprimer le point sélectionné', 'playhead.label': 'Position de lecture : {track}', 'control.pan': 'Panoramique : {track}', 'control.volume': 'Volume : {track}', 'control.volumeTitle': 'Volume', 'control.panTitle': 'Panoramique', 'control.mute': 'Couper {track}', 'fx.open': 'Ouvrir les effets de {track}',
    'status.rendering': 'Rendu stéréo en cours…', 'status.exported': 'Mixage WAV stéréo exporté.', 'status.exportError': 'L’export du mixage a échoué : {error}', 'status.fast': 'Séparation rapide en cours…', 'status.studio': 'Séparation studio en cours — comptez quelques minutes…', 'status.cached': 'Résultat chargé instantanément depuis le cache local.', 'status.finished': 'Séparation terminée. Glissez les points de n’importe quelle courbe pour automatiser son panoramique.',
    'status.cacheCleared': 'Le cache AudioSplit a été vidé. {count} élément{plural} supprimé{plural}.', 'status.trackMissing': 'La piste {track} est introuvable.', 'status.playbackChange': 'Impossible de modifier la lecture : {error}', 'status.playbackStart': 'La lecture n’a pas pu démarrer : {error}', 'status.cacheError': 'Impossible de vider le cache.', 'status.separationError': 'Erreur de séparation',
  },
  en: {
    'app.tagline': 'Separate. Mix. Export.', 'app.local': '● Local processing',
    'hero.eyebrow': 'STEM STUDIO', 'hero.title': 'Give your music<br>more space.', 'hero.description': 'Extract vocals, adjust every track, and create your own stereo version.',
    'import.title': 'Import your track', 'import.formats': 'MP3, WAV, FLAC, M4A or OGG', 'split.type': 'Separation type', 'split.simple': 'Vocals + accompaniment', 'split.detailed': 'Detailed: vocals, drums, bass, instruments',
    'speed.title': 'Separation speed', 'speed.fast': 'Fast — recommended on CPU', 'speed.studio': 'Studio — more accurate, slower', 'file.choose': 'Choose a file', 'file.separate': 'Separate vocals and accompaniment',
    'cache.clear': 'Clear AudioSplit cache', 'cache.title': 'Delete locally cached separations and temporary audio files', 'cache.confirm': 'Clear the AudioSplit cache?\n\nThis will remove from this PC:\n• previously generated stems (vocals, accompaniment, drums, bass, instruments);\n• temporary copies of imported tracks.\n\nYour original audio files and settings will not be deleted.',
    'mixer.eyebrow': 'MIXING', 'mixer.title': 'Your tracks', 'play.title': 'Play mix', 'pause.title': 'Pause playback', 'resume.title': 'Resume playback', 'stop.title': 'Stop', 'export': '↓ Export stereo WAV mix',
    'version.title': 'View version history', 'language.trigger': 'EN', 'language.triggerTitle': 'Change language',
    'language.eyebrow': 'LANGUAGE', 'language.heading': 'Choose language', 'language.description': 'Choose the interface language.', 'language.french': 'Français', 'language.english': 'English', 'close': 'Close',
    'changelog.eyebrow': 'AUDIO SPLIT STUDIO', 'changelog.heading': 'Version history', 'changelog.description': 'Studio updates, from the first release to today.', 'current': 'Current',
    'release.1.3': 'Local project library, automatic saves every 10 seconds, playback restoration, and a shared draggable playhead across all tracks.',
    'release.1.2.3': 'Safer cache: relocated button and detailed confirmation before deletion.', 'release.1.2.2': 'Version history now shows the commit date and time for every release.', 'release.1.2.1': 'Separate French and English documentation with reciprocal links.', 'release.1.2': 'French/English bilingual interface, language selector, and English GitHub documentation.', 'release.1.1.7': 'Clearable local cache, reliable play/pause, synchronized icons, and repaired playback cursor.',
    'release.1.1.6': 'Complete effects suite: compressor, EQ, reverb, delay, filters, width, and vocal ducking.', 'release.1.1.5': 'Grittier bass saturation and a vertical control integrated into its card.', 'release.1.1.4': 'Separated front-end architecture: components, styles, and dedicated modules.',
    'release.1.1.3': 'Adjustable bass saturation in Fx and version history without internal scrolling.', 'release.1.1.2': 'Added version history directly inside the application.', 'release.1.1.1': 'Fixed fast Windows model, Fx button ready for effects, and animated waveform cursor.',
    'release.1.1.0': 'Pan automation on every track, smooth curves, time markers, and faster local cache.', 'release.1.0.4': 'Integrated AudioSplit Studio logos in the interface and favicon.', 'release.1.0.3': 'Improved mixing console: visual volume/pan meters and refined interface.',
    'release.1.0.2': 'Rewrote the quick-start guide to make installation simpler.', 'release.1.0.1': 'Added automatic startup: dependency installation and app launch in one command.', 'release.1.0.0': 'First release: audio import, local Demucs separation, stereo mixing, and WAV export.',
    'release.date.1.2.3': 'Nov 11, 2026 · 11:12', 'release.date.1.2.2': 'Nov 11, 2026 · 10:45', 'release.date.1.2.1': 'Oct 29, 2026 · 10:30', 'release.date.1.2': 'Oct 29, 2026 · 10:28', 'release.date.1.1.7': 'Oct 29, 2026 · 10:11', 'release.date.1.1.6': 'Oct 29, 2026 · 10:00', 'release.date.1.1.5': 'Oct 29, 2026 · 10:00', 'release.date.1.1.4': 'Oct 29, 2026 · 10:00', 'release.date.1.1.3': 'Oct 28, 2026 · 18:23', 'release.date.1.1.2': 'Oct 28, 2026 · 18:19', 'release.date.1.1.1': 'Oct 28, 2026 · 18:17', 'release.date.1.1.0': 'Oct 28, 2026 · 09:48', 'release.date.1.0.4': 'Oct 28, 2026 · 09:20', 'release.date.1.0.3': 'Oct 28, 2026 · 09:15', 'release.date.1.0.2': 'Oct 28, 2026 · 08:44', 'release.date.1.0.1': 'Oct 28, 2026 · 08:43', 'release.date.1.0.0': 'Oct 28, 2026 · 08:39',
    'fx.eyebrow': 'EFFECTS', 'fx.close': 'Close effects', 'fx.title': 'Fx — {track}', 'fx.description': 'Adjust this track’s effects while listening.', 'fx.done': 'Close', 'fx.eq.title': '3-band EQ', 'fx.eq.description': 'Quickly adjust the track tone.', 'fx.low': 'Low', 'fx.mid': 'Mid', 'fx.high': 'High',
    'fx.filters.title': 'Filters', 'fx.filters.description': 'Quickly remove low or high frequencies.', 'fx.highPass': 'High-pass', 'fx.lowPass': 'Low-pass', 'fx.compressor.title': 'Compressor', 'fx.compressor.description': 'Smooths level differences.', 'fx.compression': 'Compression',
    'fx.reverb.title': 'Reverb', 'fx.reverb.description': 'Adds space to vocals.', 'fx.delay.title': 'Delay', 'fx.delay.description': 'Adds a rhythmic echo to vocals.', 'fx.mix': 'Mix', 'fx.width.title': 'Stereo width', 'fx.width.description': '100 keeps the original width.', 'fx.width': 'Width',
    'fx.duck.title': 'Vocal ducking', 'fx.duck.description': 'Lowers this track while vocals are playing.', 'fx.duck': 'Ducking', 'fx.bass.label': 'BASS EFFECT', 'fx.bass.title': 'Bass saturation', 'fx.bass.description': 'Adds grit to low frequencies without raising the volume.',
    'fx.empty.title': 'No effect on this track', 'fx.empty.description': 'Bass saturation is only available on {track} in this separation.',
    'stem.vocals': 'Vocals', 'stem.vocalsDetail': 'Extracted vocal stem', 'stem.accompaniment': 'Accompaniment', 'stem.accompanimentDetail': 'Music without vocals', 'stem.drums': 'Drums & kicks', 'stem.drumsDetail': 'Drums, percussion, and kicks', 'stem.bass': 'Bass', 'stem.bassDetail': 'Extracted bassline', 'stem.other': 'Instruments', 'stem.otherDetail': 'Other instruments and pads',
    'automation.pan': 'Pan {track}', 'automation.left': 'Left', 'automation.center': 'Center', 'automation.right': 'Right', 'automation.remove': 'Remove selected point', 'playhead.label': 'Playback position: {track}', 'control.pan': 'Pan: {track}', 'control.volume': 'Volume: {track}', 'control.volumeTitle': 'Volume', 'control.panTitle': 'Pan', 'control.mute': 'Mute {track}', 'fx.open': 'Open effects for {track}',
    'status.rendering': 'Rendering stereo mix…', 'status.exported': 'Stereo WAV mix exported.', 'status.exportError': 'Mix export failed: {error}', 'status.fast': 'Fast separation in progress…', 'status.studio': 'Studio separation in progress — this can take a few minutes…', 'status.cached': 'Result loaded instantly from the local cache.', 'status.finished': 'Separation complete. Drag points on any curve to automate its pan.',
    'status.cacheCleared': 'AudioSplit cache cleared. {count} item{plural} deleted.', 'status.trackMissing': 'Track {track} was not found.', 'status.playbackChange': 'Could not change playback: {error}', 'status.playbackStart': 'Playback could not start: {error}', 'status.cacheError': 'Could not clear the cache.', 'status.separationError': 'Separation error',
  },
};

const listeners = new Set();
let language = localStorage.getItem('audiosplit-language') === 'en' ? 'en' : 'fr';

export function getLanguage() { return language; }

export function t(key, values = {}) {
  const template = messages[language][key] ?? messages.fr[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function applyTranslations() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((element) => { element.innerHTML = t(element.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => { element.title = t(element.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => { element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel)); });
}

export function setLanguage(nextLanguage) {
  language = nextLanguage === 'en' ? 'en' : 'fr';
  localStorage.setItem('audiosplit-language', language);
  applyTranslations();
  listeners.forEach((listener) => listener(language));
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
