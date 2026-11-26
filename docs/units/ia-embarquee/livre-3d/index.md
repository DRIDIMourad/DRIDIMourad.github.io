---
hide:
  - navigation
  - toc
---

# Le livre animé de l'unité

Feuilletez l'unité **IA embarquée** comme un livre pop-up : chaque double page est un chapitre, et sa scène se déplie quand vous tournez la page. Cliquez sur les pastilles **+** pour découvrir un élément, puis ouvrez la page du cours, du TD, du TP ou du projet correspondant.

<link rel="stylesheet" href="livre3d.css">

<div id="livre3d" class="livre3d">
  <div class="livre3d__stage" tabindex="0" aria-label="Livre 3D interactif : faites glisser pour tourner autour, flèches gauche et droite pour changer de page">
    <div class="livre3d__chargement">Chargement du livre…</div>
    <div class="livre3d__tip" hidden></div>
    <aside class="livre3d__panneau" hidden aria-live="polite">
      <button type="button" class="livre3d__fermer" aria-label="Fermer">×</button>
      <p class="livre3d__kicker"></p>
      <p class="livre3d__titre"></p>
      <p class="livre3d__texte"></p>
      <a class="livre3d__ouvrir" href="#">Ouvrir la page →</a>
    </aside>
    <p class="livre3d__aide">Glisser : tourner autour · Molette : zoomer · Clic sur le bord d'une page : la tourner</p>
  </div>
  <div class="livre3d__barre">
    <button type="button" class="livre3d__btn" data-action="prec" aria-label="Page précédente">←</button>
    <nav class="livre3d__chapitres" aria-label="Chapitres du livre"></nav>
    <button type="button" class="livre3d__btn" data-action="suiv" aria-label="Page suivante">→</button>
    <span class="livre3d__sep"></span>
    <button type="button" class="livre3d__btn" data-action="vue" title="Recentrer la vue" aria-label="Recentrer la vue">⟲</button>
    <button type="button" class="livre3d__btn" data-action="plein" title="Plein écran" aria-label="Plein écran">⛶</button>
  </div>
</div>

<script type="importmap">
{ "imports": {
    "three": "../../../assets/vendor/three/three.module.min.js",
    "three/addons/": "../../../assets/vendor/three/"
} }
</script>
<script type="module" src="livre3d.js"></script>

## Sommaire du livre

| Chapitre | Pages de l'unité |
|---|---|
| 1. La carte FRDM-MCXN947 | [Cours 1](../cours/cours1/index.md) · [Cours 2](../cours/cours2/index.md) · [TD1](../td/td1/index.md) · [TP1](../tp/tp1/index.md) |
| 2. Les cours | [Cours 1 : Initiation à la carte](../cours/cours1/index.md) · [Cours 2 : Les architectures NPU](../cours/cours2/index.md) · [Cours 3 : La chaîne eIQ](../cours/cours3/index.md) |
| 3. TD1 : prise en main | [TD1 : LED RGB, boutons, FreeRTOS](../td/td1/index.md) |
| 4. Les TP | [TP1 : Classification sur NPU](../tp/tp1/index.md) · [TP2 : Entraîner son modèle](../tp/tp2/index.md) · [TP3 : Détecter un feu](../tp/tp3/index.md) |
| 5. Projet | [Projet 1 : Flotte de drones](../projet/projet1/index.md) |
