# Feuille de route AudioSplit Studio — de la v1.3.5 à la V2

> Feuille de route proposée, sans dates garanties. Les étapes pourront être ajustées selon les retours et les essais sur Windows.

## Cap de la V2

Faire d’AudioSplit Studio une application audio Windows fiable et simple à installer, qui garde le traitement sur le PC et permet de reprendre ses projets sans compte ni base de données.

La V2 devra conserver les fonctions utiles de la v1 : séparation locale, mixeur multipiste, automation, effets, lecture, export stéréo, bibliothèque de projets, interface française et anglaise. La migration des projets locaux devra être prévue avant toute modification de leur format.

## Versions prévues

### v1.3.6 — Fiabilité du studio

- Stabiliser les actions de lecture, pause, arrêt et annulation d’une séparation.
- Afficher des erreurs courtes et compréhensibles, avec les détails techniques conservés dans les journaux.
- Vérifier que les contrôles de toutes les pistes réagissent en direct et que l’export reprend exactement le mix entendu.
- Vérifier les messages français et anglais après chaque action et chaque erreur.

**Prêt quand :** les parcours courants fonctionnent après un redémarrage du serveur et une actualisation du navigateur, sans erreur JavaScript non gérée.

### v1.3.7 — Projets locaux plus sûrs

- Rendre plus visibles l’état enregistré et les erreurs de sauvegarde automatique.
- Renforcer la récupération après fermeture inattendue pendant l’enregistrement.
- Clarifier la différence entre le cache temporaire et la bibliothèque durable des projets.
- Vérifier l’import et l’export ZIP, y compris les archives invalides et les doublons de noms.

**Prêt quand :** un projet avec pistes, effets et courbes survit à la fermeture puis se rouvre avec le même mixage ; vider le cache ne supprime jamais un projet.

### v1.3.8 — Confort de mixage

- Ajouter des commandes « Solo » et une commande pour réinitialiser les réglages d’une piste.
- Montrer un indicateur de niveau et signaler une sortie trop forte avant l’export.
- Harmoniser les états actifs, désactivés et au survol des commandes dans le mixeur et les modaux.
- Améliorer l’usage clavier et les libellés accessibles des contrôles.

**Prêt quand :** les nouvelles commandes restent synchronisées avec la lecture, les sauvegardes de projets et l’export.

### v1.4.0 — Organisation des sessions

- Ajouter des préréglages de mixage réutilisables, séparés des projets audio.
- Permettre de dupliquer une session pour essayer une autre version du mix sans écraser l’originale.
- Ajouter une recherche et un tri dans la bibliothèque locale.
- Documenter les limites d’espace disque et rendre le nettoyage plus précis.

**Prêt quand :** les préréglages et duplications sont persistants, exportables et restaurables sans base de données.

### v1.4.1 — Analyse musicale

- Détecter le tempo en BPM et la tonalité, avec un indicateur de confiance et la possibilité de corriger manuellement les valeurs.
- Afficher la durée, la mesure estimée, le nombre de canaux, la fréquence d’échantillonnage et la profondeur de bits.
- Ajouter des informations de niveau : crête, niveau moyen et loudness estimé lorsque l’analyse le permet.
- Distinguer les informations mesurées automatiquement des valeurs corrigées par l’utilisateur.

**Prêt quand :** l’analyse fonctionne localement sur les formats pris en charge, indique quand son estimation est incertaine et permet toujours une saisie manuelle.

### v1.4.2 — Tempo et tonalité modifiables

- Permettre de régler le BPM cible et la transposition en demi-tons indépendamment.
- Préécouter le changement avant de l’appliquer au mix.
- Utiliser un traitement temporel qui change le tempo sans changer la hauteur, et un décalage de tonalité sans changer le tempo.
- Appliquer le même changement à toutes les pistes afin de préserver leur synchronisation.
- Garder les fichiers importés intacts et enregistrer les réglages de tempo et de tonalité dans le projet.

**Prêt quand :** lecture et export donnent le même résultat, les pistes restent calées ensemble et rouvrir le projet restaure les réglages sans modifier l’original.

### v1.4.3 — Finition de l’analyse et des transformations

- Permettre de réinitialiser le mix à la tonalité et au tempo d’origine.
- Afficher les valeurs d’origine et les valeurs modifiées côte à côte.
- Prévenir quand une grande transposition ou un changement important de tempo risque d’altérer la qualité.
- Vérifier l’alignement des courbes d’automation et des repères de lecture après transformation.

**Prêt quand :** projets anciens, pistes détaillées, sauvegarde automatique et export WAV restent cohérents avec les valeurs affichées.

### v1.5.0 — Chaînes d’effets

- Permettre d’activer ou de contourner chaque effet individuellement.
- Organiser les effets par piste et rendre leur ordre de traitement explicite.
- Ajouter des préréglages d’effets par type de piste : voix, basse, batterie et accompagnement.
- Vérifier la cohérence entre lecture temps réel, sauvegarde du projet et export hors ligne.

**Prêt quand :** les effets ne changent pas de son ni de réglage entre écoute, rechargement d’un projet et rendu final.

### v1.5.1 — Routage des effets

- Définir l’ordre du signal pour chaque piste et afficher clairement la chaîne d’effets.
- Permettre de déplacer les effets dans la chaîne.
- Garder un contournement activable pour chaque effet sans perdre ses réglages.

**Prêt quand :** changer l’ordre ou contourner un effet met à jour l’écoute, la sauvegarde et l’export de façon identique.

### v1.5.2 — Comparaison et préréglages d’effets

- Comparer rapidement une piste avec et sans sa chaîne d’effets.
- Enregistrer et rappeler des préréglages par type de piste.
- Inclure les préréglages dans une sauvegarde de projet et prévenir quand un effet n’est pas disponible sur une piste.

**Prêt quand :** les préréglages peuvent être rappelés après redémarrage sans remplacer les fichiers audio d’origine.

### v1.5.3 — Finition des effets

- Ajouter des valeurs initiales cohérentes et une remise à zéro par effet.
- Améliorer les descriptions, unités, plages et libellés français/anglais.
- Mesurer la charge CPU des chaînes longues et limiter les cas qui peuvent interrompre la lecture.

**Prêt quand :** lecture et export restent stables avec plusieurs effets actifs sur plusieurs pistes.

### v1.6.0 — Réglages d’export

- Proposer plusieurs fréquences d’échantillonnage et profondeurs de bits compatibles WAV.
- Afficher une estimation de taille et d’espace libre avant un rendu important.
- Garder une protection contre l’écrêtage et expliquer quand le niveau du mix est réduit.

**Prêt quand :** les fichiers exportés s’ouvrent correctement dans des lecteurs et logiciels audio courants, avec les paramètres annoncés.

### v1.6.1 — Exports des pistes

- Exporter le mix stéréo ou chaque piste séparément.
- Garder la même durée, le même point de départ et la même fréquence pour toutes les pistes exportées.
- Nommer clairement les fichiers et permettre de choisir le dossier de destination.

**Prêt quand :** les fichiers individuels peuvent être réimportés ensemble dans un logiciel audio sans décalage.

### v1.6.2 — Loudness et métadonnées

- Ajouter des informations de niveau utiles avant l’export : crête, loudness intégré estimé et risque d’écrêtage.
- Proposer une normalisation avec aperçu du gain appliqué.
- Écrire les métadonnées WAV prises en charge et signaler celles qui ne peuvent pas être conservées.

**Prêt quand :** les niveaux annoncés correspondent au fichier effectivement produit et la normalisation reste désactivable.

### v1.6.3 — File d’exports

- Préparer plusieurs rendus dans une file locale avec progression et possibilité d’annuler le rendu en cours.
- Permettre d’exporter plusieurs projets ou variantes sans relancer chaque opération à la main.
- Reprendre proprement après une erreur d’espace disque ou un export annulé.

**Prêt quand :** une erreur sur un rendu ne corrompt ni les projets ni les fichiers déjà terminés.

### v1.6.4 — Préréglages et vérification d’export

- Enregistrer des préréglages d’export pour les formats et niveaux utilisés régulièrement.
- Afficher le récapitulatif exact des paramètres et la taille estimée avant validation.
- Vérifier la durée, le nombre de canaux et la lisibilité des fichiers après export.

**Prêt quand :** le récapitulatif avant export correspond aux propriétés du fichier final.

### v1.7.0 — Séparation et performances

- Isoler le moteur de séparation derrière une interface stable pour faciliter le changement de modèle.
- Définir les informations que chaque modèle doit déclarer : pistes produites, qualité, mémoire et matériel requis.

**Prêt quand :** l’interface peut utiliser un moteur local sans dépendre directement des détails d’un seul modèle.

### v1.7.1 — Gestion des modèles

- Afficher les modèles disponibles, leur taille, leur compatibilité et leur état de téléchargement.
- Télécharger à la demande, reprendre un téléchargement interrompu et signaler l’espace disque requis.
- Garder un mode CPU simple comme parcours de référence.

**Prêt quand :** l’utilisateur sait quel modèle sera lancé et peut relancer ou supprimer son cache de modèle sans supprimer ses projets.

### v1.7.2 — Optimisation CPU et mémoire

- Mesurer le temps et la mémoire des modes rapide et studio sur plusieurs durées et machines Windows.
- Réduire les copies inutiles de gros fichiers audio et libérer la mémoire après les rendus.
- Donner une estimation du temps basée sur la progression observée, sans promettre une durée exacte.

**Prêt quand :** la séparation ne fait pas dépasser les limites mémoire prévues et l’application reste utilisable après plusieurs pistes.

### v1.7.3 — Prototype d’accélération GPU

- Étudier une accélération GPU facultative et sa compatibilité avec les versions de PyTorch et les pilotes pris en charge.
- Détecter les incompatibilités avant de lancer un travail et permettre un retour CPU propre.
- Garder l’accélération désactivée si son installation ou son fonctionnement ne sont pas fiables.

**Prêt quand :** le parcours CPU reste inchangé et fonctionne même si l’accélération GPU échoue.

### v1.7.4 — Tests de stabilité du moteur

- Vérifier les longues pistes, les fichiers atypiques, l’annulation, le cache et les erreurs de modèle.
- Comparer les modes rapide et studio sur un jeu de morceaux de test reproductible.
- Documenter les compromis de temps, mémoire et qualité avant de choisir les valeurs par défaut.

**Prêt quand :** les limites et comportements des modèles sont connus et présentés clairement dans l’application.

### v1.8.0 — Préparation de l’application Windows

- Établir une preuve de concept qui ouvre AudioSplit dans une fenêtre dédiée.
- Comparer les solutions d’empaquetage sans figer la technologie avant d’avoir vérifié les besoins du moteur audio.

**Prêt quand :** le prototype démontre qu’il peut démarrer, séparer, mixer et exporter sur une installation Windows propre.

### v1.8.1 — Choix de l’architecture de bureau

- Décider comment la fenêtre, l’interface web locale et le moteur Python communiquent.
- Définir les chemins d’installation, les chemins de données utilisateur et la gestion de FFmpeg.
- Écrire les critères de mise à jour et de désinstallation avant de choisir l’outil de packaging.

**Prêt quand :** le schéma d’architecture et les limites de sécurité sont documentés et validés par un prototype.

### v1.8.2 — Prototype d’installation

- Construire un installateur expérimental incluant l’application et son runtime nécessaire.
- Télécharger les poids de modèles à la demande plutôt que d’imposer un gros téléchargement initial.
- Vérifier les droits d’écriture, les espaces avec accents et les chemins Windows longs.

**Prêt quand :** installation, lancement et désinstallation sont reproductibles sur une machine sans environnement de développement.

### v1.8.3 — Données et paramètres utilisateur

- Déplacer les projets, réglages et modèles vers des emplacements utilisateur stables.
- Permettre de choisir un emplacement de bibliothèque et afficher l’espace utilisé.
- Prévoir sauvegarde et restauration avant toute migration de format.

**Prêt quand :** mettre à jour ou désinstaller l’application ne supprime pas les projets sans demande explicite.

### v1.8.4 — Mise à jour et réparation

- Définir la mise à jour d’application et la réparation d’une installation incomplète.
- Conserver la version précédente jusqu’à ce que la nouvelle démarre correctement.
- Afficher un diagnostic exportable qui ne contient pas de musique ni de données personnelles par défaut.

**Prêt quand :** une mise à jour interrompue peut être réparée sans perdre la bibliothèque.

### v1.8.5 — Contrôle bilingue et accessibilité

- Vérifier les écrans d’installation, d’erreur, de progression et de récupération en français et en anglais.
- Vérifier clavier, focus, tailles de fenêtre et affichage à différentes échelles Windows.
- Préparer une documentation d’installation et de dépannage hors ligne.

**Prêt quand :** les tâches principales peuvent être terminées dans les deux langues sans commandes manuelles.

### v1.9.0 — Bêta V2

- Créer une version Alpha réservée à la validation des fonctions principales et de l’installation.
- Tester sur plusieurs configurations Windows sans migrer la bibliothèque originale des testeurs.

**Prêt quand :** les scénarios principaux passent et les problèmes de migration ou d’installation sont consignés avant la bêta publique.

### v1.9.1 — Migration de projets

- Copier une bibliothèque v1 dans un espace de test v2 et migrer les manifestes sans toucher aux sources.
- Vérifier les réglages de mixage, courbes, effets, noms de dossiers et archives ZIP.
- Fournir un rapport de migration avec les éléments importés ou ignorés.

**Prêt quand :** chaque migration est vérifiable, sauvegardée et réversible avant validation par l’utilisateur.

### v1.9.2 — Bêta privée

- Faire tester installation, séparation, projets, effets, changements BPM/tonalité, export et mise à jour.
- Collecter les retours à partir d’un rapport fourni volontairement par l’utilisateur.
- Corriger d’abord les pertes de données, blocages, problèmes de synchronisation et échecs d’installation.

**Prêt quand :** aucun défaut bloquant connu ne compromet les fichiers audio ou les projets.

### v1.9.3 — Bêta publique

- Publier un installateur bêta avec avertissement de préversion et procédure de retour à la version stable.
- Vérifier les installations et mises à jour à partir d’une sélection de configurations Windows.
- Maintenir la possibilité d’exporter les projets dans un format documenté.

**Prêt quand :** les retours bêta sont triés, reproductibles et traités avant la période de stabilisation.

### v1.9.4 — Release candidate

- Geler les changements de format de projet et les nouvelles fonctions.
- Corriger les défauts restants, vérifier la signature et les empreintes des artefacts de distribution.
- Effectuer une dernière passe d’installation propre, migration, sauvegarde et restauration.

**Prêt quand :** aucun défaut critique ou élevé ne reste ouvert dans les parcours de sortie.

### v1.9.5 — Préparation de publication

- Finaliser notes de version, guide de migration, exigences système et procédure de dépannage.
- Vérifier les liens, les noms de fichiers, la version affichée et les sommes de contrôle.
- Confirmer que les fichiers personnels et modèles ne sont pas inclus dans les artefacts publics.

**Prêt quand :** l’installateur et la documentation correspondent exactement à la version candidate validée.

### v2.0.0 — Première version stable

- Publier l’application Windows avec un installateur guidé et un lancement direct.
- Conserver le traitement audio local et expliquer clairement les téléchargements de modèles requis.
- Importer les projets de la v1 sans perte, avec une sauvegarde préalable et un message en cas d’incompatibilité.
- Livrer une documentation de démarrage, de sauvegarde, de mise à jour et de dépannage en français et en anglais.

**Critères de sortie :** installation propre vérifiée, séparation et export vérifiés, projets persistants vérifiés, parcours bilingue complet, aucune régression bloquante connue.

## Règles pour chaque version

- Ne pas annoncer une fonction comme terminée avant de l’avoir vérifiée dans l’application.
- Garder les projets et les pistes sur le PC ; aucune migration ne doit supprimer les données d’origine.
- Ajouter les nouvelles chaînes en français et en anglais en même temps.
- Faire un commit et un tag uniquement après validation de la version concernée.
- Ne pas faire dépendre le parcours CPU de la présence d’une carte graphique.

## Hors périmètre prévu pour la V2

- Compte utilisateur obligatoire ou synchronisation cloud obligatoire.
- Base de données serveur pour les projets personnels.
- Téléchargement automatique de modèles sans information claire ni choix de l’utilisateur.
