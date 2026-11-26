/*
 * Livre animé 3D de l'unité IA embarquée.
 *
 * Un livre ouvert en 3D (three.js, copie locale dans docs/assets/vendor/three) :
 * chaque double page est un chapitre de l'unité, et une scène « pop-up » se
 * déplie quand on tourne la page. Les éléments marqués d'une pastille sont
 * cliquables et ouvrent la page du cours, du TD, du TP ou du projet.
 *
 * Pour changer un texte ou un lien : modifier le tableau CHAPITRES ci-dessous.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";

/* ------------------------------------------------------------------ */
/* Contenu (textes et liens)                                          */
/* ------------------------------------------------------------------ */

const LIENS = {
  cours1: "../cours/cours1/",
  cours2: "../cours/cours2/",
  cours3: "../cours/cours3/",
  td1: "../td/td1/",
  tp1: "../tp/tp1/",
  tp2: "../tp/tp2/",
  tp3: "../tp/tp3/",
  projet1: "../projet/projet1/",
};

const CHAPITRES = [
  {
    id: "carte",
    court: "La carte",
    kicker: "Chapitre 1",
    couleur: "#1f8a70",
    titre: "La carte FRDM-MCXN947",
    texte: [
      "Toute l'unité tourne autour de cette carte NXP. Son microcontrôleur MCX N947 réunit deux cœurs Arm Cortex-M33 à 150 MHz, 2 Mo de Flash, 512 Ko de SRAM et un accélérateur de réseaux de neurones : le NPU eIQ Neutron.",
      "La carte s'est dépliée sur la page de droite. Chaque pastille ouvre la partie de l'unité où ce composant entre en jeu.",
    ],
    liste: [
      ["Le microcontrôleur", "Cours 1"],
      ["Le NPU eIQ Neutron", "Cours 2"],
      ["La LED RGB et les boutons", "TD1"],
      ["Flasher, lire le terminal série", "TP1"],
    ],
    legende: "Vue stylisée de la carte (composants non placés à l'échelle)",
  },
  {
    id: "cours",
    court: "Cours",
    kicker: "Chapitre 2",
    couleur: "#6c5ce7",
    titre: "Les cours",
    texte: [
      "Trois cours pour comprendre avant de manipuler : la carte et ses outils, l'architecture d'un NPU, puis la chaîne eIQ qui transforme un réseau entraîné en un programme pour le NPU.",
    ],
    liste: [
      ["Cours 1 : Initiation à la carte", "microcontrôleur, mémoire, broches, outils"],
      ["Cours 2 : Les architectures NPU", "calcul en parallèle, entiers 8 bits"],
      ["Cours 3 : La chaîne eIQ", "apprentissage, quantification, conversion"],
    ],
    legende: "Cliquez sur une scène pour ouvrir le cours",
  },
  {
    id: "td",
    court: "TD",
    kicker: "Chapitre 3",
    couleur: "#00a99d",
    titre: "TD1 : prise en main de la carte",
    texte: [
      "Premiers pas en partant des exemples du SDK : faire clignoter la LED RGB, réagir aux boutons SW2 et SW3, puis découper un programme en tâches FreeRTOS, comme le logiciel d'un drone.",
    ],
    liste: [
      ["La LED RGB", "rouge, verte, bleue, actives à l'état bas"],
      ["Les boutons", "SW2 et SW3, lus par interruption"],
      ["FreeRTOS", "les tâches STAB, NAV et TELEM d'un drone"],
    ],
    legende: "Les trois tâches s'exécutent à leur propre rythme",
  },
  {
    id: "tp",
    court: "TP",
    kicker: "Chapitre 4",
    couleur: "#e08a00",
    titre: "Les TP",
    texte: [
      "Trois séances pour passer du modèle tout fait au modèle que vous entraînez vous-même : classer une image sur le NPU, entraîner un classifieur de fleurs avec eIQ Portal, puis détecter un feu et déclencher une alerte.",
    ],
    liste: [
      ["TP1 : Classification d'images sur NPU", "label_image, CPU contre NPU"],
      ["TP2 : Entraîner son modèle avec eIQ Portal", "fleurs, int8, conversion Neutron"],
      ["TP3 : Détecter un feu sur le NPU", "fausses alarmes, LED d'alerte, bouton"],
    ],
    legende: "Une scène par TP : cliquez pour l'ouvrir",
  },
  {
    id: "projet",
    court: "Projet",
    kicker: "Chapitre 5",
    couleur: "#d63c2f",
    titre: "Projet : la flotte de drones",
    texte: [
      "Le projet évalué réunit tout : un drone survole l'autoroute, son réseau de neurones repère un accident sur les images de sa caméra, et il prévient les drones voisins par radio.",
      "Une séance de 4 heures, en autonomie, à partir d'un cahier des charges.",
    ],
    liste: [["Projet 1 : Flotte de drones", "détection d'accidents sur autoroute"]],
    legende: "Un drone repère l'accident et alerte ses voisins",
  },
];

/* ------------------------------------------------------------------ */
/* Réglages                                                           */
/* ------------------------------------------------------------------ */

const PW = 4.2; // largeur d'une page
const PD = 5.6; // profondeur (hauteur) d'une page
const PY = 0.32; // hauteur de la surface des pages
const PI = Math.PI;
const reduceMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const VITESSE = reduceMotion ? 0.35 : 1;
const FONT = '"IBM Plex Sans", "Segoe UI", Arial, sans-serif';

const root = document.getElementById("livre3d");
if (root) demarrer(root).catch((e) => echec(root, e));

function echec(el, e) {
  console.error(e);
  el.classList.add("livre3d--echec");
  const stage = el.querySelector(".livre3d__stage");
  if (stage)
    stage.innerHTML =
      '<p class="livre3d__erreur">Votre navigateur ne peut pas afficher la 3D (WebGL). Le sommaire ci-dessous donne les mêmes liens.</p>';
}

/* ------------------------------------------------------------------ */
/* Petits outils                                                      */
/* ------------------------------------------------------------------ */

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => {
  const c1 = 1.5, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.r ?? 0.65,
    metalness: o.m ?? 0,
    emissive: o.e ?? 0x000000,
    emissiveIntensity: o.ei ?? 1,
    map: o.map ?? null,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
}

function box(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

function texture(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function wrap(ctx, text, x, y, maxW, lh) {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = w;
    } else line = t;
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lh;
  }
  return y;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Papier : couleur crème, léger grain, ombre près du dos du livre */
function papier(ctx, w, h, dosAGauche) {
  ctx.fillStyle = "#fbf7ee";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = `rgba(120,100,60,${Math.random() * 0.035})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  const g = dosAGauche
    ? ctx.createLinearGradient(0, 0, w * 0.18, 0)
    : ctx.createLinearGradient(w, 0, w * 0.82, 0);
  g.addColorStop(0, "rgba(60,45,20,.22)");
  g.addColorStop(1, "rgba(60,45,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* Panneau de texte posé dans la scène (étiquette) */
function etiquette(renderer, lignes, o = {}) {
  const W = o.w ?? 512, H = o.h ?? 200;
  const [c, ctx] = canvas(W, H);
  roundRect(ctx, 6, 6, W - 12, H - 12, 26);
  ctx.fillStyle = o.fond ?? "#ffffff";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = o.couleur ?? "#2e2a8c";
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (lignes.length === 1) {
    ctx.fillStyle = o.couleur ?? "#2e2a8c";
    ctx.font = `700 ${o.taille ?? 72}px ${FONT}`;
    ctx.fillText(lignes[0], W / 2, H / 2 + 4);
  } else {
    ctx.fillStyle = o.couleur ?? "#2e2a8c";
    ctx.font = `700 ${(o.taille ?? 60) * 0.62}px ${FONT}`;
    ctx.fillText(lignes[0].toUpperCase(), W / 2, H * 0.32);
    ctx.fillStyle = "#1f2433";
    ctx.font = `700 ${o.taille ?? 60}px ${FONT}`;
    ctx.fillText(lignes[1], W / 2, H * 0.66);
  }
  const sw = o.largeur ?? 1.2;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(sw, (sw * H) / W),
    new THREE.MeshStandardMaterial({ map: texture(c, renderer), transparent: true, roughness: 0.8, side: THREE.DoubleSide })
  );
  m.castShadow = true;
  return m;
}

/* ------------------------------------------------------------------ */
/* Textures des pages                                                 */
/* ------------------------------------------------------------------ */

const TW = 1200, TH = 1600;

function pageGauche(renderer, ch, num) {
  const [c, ctx] = canvas(TW, TH);
  papier(ctx, TW, TH, false);
  const x = 110, maxW = TW - 230;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ch.couleur;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(ch.kicker.toUpperCase(), x, 190);
  ctx.fillStyle = "#1a1d2b";
  ctx.font = `700 76px ${FONT}`;
  let y = wrap(ctx, ch.titre, x, 280, maxW, 88);
  ctx.fillStyle = ch.couleur;
  ctx.fillRect(x, y - 30, 140, 12);
  y += 50;
  ctx.fillStyle = "#33384a";
  ctx.font = `400 37px ${FONT}`;
  for (const p of ch.texte) y = wrap(ctx, p, x, y, maxW, 52) + 22;
  y += 14;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = "#7a7f92";
  ctx.fillText("À EXPLORER", x, y);
  y += 30;
  for (const [t, s] of ch.liste) {
    roundRect(ctx, x, y, maxW, 104, 22);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ch.couleur + "55";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 48, y + 52, 16, 0, 2 * PI);
    ctx.fillStyle = ch.couleur;
    ctx.fill();
    ctx.fillStyle = "#1a1d2b";
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(t, x + 88, y + 46);
    ctx.fillStyle = "#6a6f82";
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText(s, x + 88, y + 84);
    y += 118;
  }
  ctx.fillStyle = "#9a9db0";
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText("IA embarquée", x, TH - 80);
  ctx.textAlign = "right";
  ctx.fillText(String(num), TW - 120, TH - 80);
  return texture(c, renderer);
}

function pageDroite(renderer, ch, num) {
  const [c, ctx] = canvas(TW, TH);
  papier(ctx, TW, TH, true);
  ctx.fillStyle = "rgba(46,42,140,.07)";
  for (let gx = 120; gx < TW - 60; gx += 60)
    for (let gy = 120; gy < TH - 200; gy += 60) {
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, 2 * PI);
      ctx.fill();
    }
  ctx.textAlign = "center";
  ctx.fillStyle = ch.couleur;
  ctx.font = `italic 400 34px ${FONT}`;
  ctx.fillText(ch.legende, TW / 2, TH - 150);
  ctx.fillStyle = "#9a9db0";
  ctx.font = `400 30px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(String(num), TW - 110, TH - 80);
  ctx.textAlign = "left";
  ctx.fillText("Tourner la page  →", 130, TH - 80);
  return texture(c, renderer);
}

function couverture(renderer) {
  const W = 1240, H = 1660;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#3a35a8");
  g.addColorStop(1, "#1d1a5e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // pistes de circuit imprimé
  ctx.strokeStyle = "rgba(160,170,255,.22)";
  ctx.lineWidth = 6;
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * W, y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      if (k % 2) x += (Math.random() - 0.5) * 420;
      else y += (Math.random() - 0.5) * 420;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * PI);
    ctx.fillStyle = "rgba(160,170,255,.35)";
    ctx.fill();
  }
  // puce et grille du NPU
  const cx = W / 2, cy = 640;
  ctx.fillStyle = "#11102e";
  roundRect(ctx, cx - 230, cy - 230, 460, 460, 30);
  ctx.fill();
  ctx.strokeStyle = "#ffd36e";
  ctx.lineWidth = 8;
  for (let i = -3; i <= 3; i++) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 58, cy + s * 230);
      ctx.lineTo(cx + i * 58, cy + s * 290);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + s * 230, cy + i * 58);
      ctx.lineTo(cx + s * 290, cy + i * 58);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      ctx.fillStyle = `hsl(${250 + (i + j) * 12}, 90%, ${60 + ((i * j) % 3) * 8}%)`;
      roundRect(ctx, cx - 150 + i * 78, cy - 150 + j * 78, 60, 60, 10);
      ctx.fill();
    }
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 120px ${FONT}`;
  ctx.fillText("IA embarquée", cx, 1130);
  ctx.fillStyle = "#ffd36e";
  ctx.font = `400 52px ${FONT}`;
  ctx.fillText("Le livre animé de l'unité", cx, 1215);
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = `400 40px ${FONT}`;
  ctx.fillText("Un réseau de neurones sur le NPU du MCX N947", cx, 1300);
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("Cliquez pour ouvrir", cx, 1520);
  ctx.strokeStyle = "rgba(255,211,110,.8)";
  ctx.lineWidth = 5;
  roundRect(ctx, 40, 40, W - 80, H - 80, 30);
  ctx.stroke();
  return texture(c, renderer);
}

/* Face du circuit imprimé (sérigraphie et pistes) */
function facePCB(renderer) {
  const W = 1024, H = 660;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = "#16624f";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(120,220,180,.35)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 40; i++) {
    let x = Math.random() * W, y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    x += (Math.random() - 0.5) * 300;
    ctx.lineTo(x, y);
    y += (Math.random() - 0.5) * 200;
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#f4f4ee";
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText("FRDM-MCXN947", 40, 620);
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText("SW2", 82, 520);
  ctx.fillText("SW3", 196, 520);
  ctx.fillText("RGB", 860, 520);
  ctx.fillText("MCU-LINK", 70, 84);
  ctx.fillText("USB", 830, 84);
  ctx.strokeStyle = "#f4f4ee";
  ctx.lineWidth = 3;
  roundRect(ctx, 12, 12, W - 24, H - 24, 26);
  ctx.stroke();
  return texture(c, renderer);
}

function dessusPuce(renderer) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = "#1b1c22";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#d8d8de";
  ctx.textAlign = "center";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("NXP", 128, 100);
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText("MCX N947", 128, 150);
  ctx.beginPath();
  ctx.arc(36, 220, 10, 0, 2 * PI);
  ctx.fill();
  return texture(c, renderer);
}

/* Photo stylisée d'une pizza (TP1) */
function photoPizza(renderer) {
  const [c, ctx] = canvas(512, 420);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 512, 420);
  ctx.fillStyle = "#f3e6cf";
  ctx.fillRect(20, 20, 472, 300);
  ctx.beginPath();
  ctx.arc(256, 170, 125, 0, 2 * PI);
  ctx.fillStyle = "#e0a54a";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(256, 170, 105, 0, 2 * PI);
  ctx.fillStyle = "#e8532f";
  ctx.fill();
  ctx.fillStyle = "#fff3c4";
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc(256 + Math.cos(i * 2.1) * 60, 170 + Math.sin(i * 2.1) * 55, 18, 0, 2 * PI);
    ctx.fill();
  }
  ctx.fillStyle = "#8b1d1d";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(256 + Math.cos(i * 1.05 + 0.4) * 75, 170 + Math.sin(i * 1.05 + 0.4) * 70, 13, 0, 2 * PI);
    ctx.fill();
  }
  ctx.fillStyle = "#2e2a8c";
  ctx.textAlign = "center";
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText("pizza : 96 %", 256, 372);
  ctx.fillStyle = "#6a6f82";
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText("en 12 ms sur le NPU", 256, 404);
  return texture(c, renderer);
}

function pastille(renderer) {
  const [c, ctx] = canvas(128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, 2 * PI);
  ctx.fillStyle = "rgba(255,255,255,.95)";
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#2e2a8c";
  ctx.stroke();
  ctx.fillStyle = "#2e2a8c";
  ctx.fillRect(40, 58, 48, 12);
  ctx.fillRect(58, 40, 12, 48);
  return texture(c, renderer);
}

/* ------------------------------------------------------------------ */
/* Programme principal                                                */
/* ------------------------------------------------------------------ */

async function demarrer(root) {
  const stage = root.querySelector(".livre3d__stage");
  const tip = root.querySelector(".livre3d__tip");
  const panneau = root.querySelector(".livre3d__panneau");
  const chips = root.querySelector(".livre3d__chapitres");
  const btnPrec = root.querySelector("[data-action=prec]");
  const btnSuiv = root.querySelector("[data-action=suiv]");
  const btnVue = root.querySelector("[data-action=vue]");
  const btnPlein = root.querySelector("[data-action=plein]");

  // Polices du site avant de dessiner les pages
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`700 40px ${FONT}`),
        document.fonts.load(`400 40px ${FONT}`),
      ]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch (e) { /* police de secours */ }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 22;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.28;
  controls.minAzimuthAngle = -1.0;
  controls.maxAzimuthAngle = 1.0;
  controls.rotateSpeed = 0.6;

  const VUE_FERME = { cible: new THREE.Vector3(PW / 2, PY, 0.2), cam: new THREE.Vector3(PW / 2 + 0.8, 8.2, 8.4) };
  const VUE_OUVERT = { cible: new THREE.Vector3(0, 0.7, 0.3), cam: new THREE.Vector3(0, 7.9, 9.0) };
  // sur un écran étroit, on recule la caméra pour garder le livre entier
  let recul = 1;
  const ajuste = (V) => ({ cible: V.cible, cam: V.cible.clone().add(V.cam.clone().sub(V.cible).multiplyScalar(recul)) });
  controls.target.copy(VUE_FERME.cible);
  camera.position.copy(VUE_FERME.cam);

  // Lumières
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bde0, 1.25));
  const soleil = new THREE.DirectionalLight(0xffffff, 1.9);
  soleil.position.set(-4, 12, 7);
  soleil.castShadow = true;
  soleil.shadow.mapSize.set(2048, 2048);
  Object.assign(soleil.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  soleil.shadow.bias = -0.0004;
  soleil.shadow.normalBias = 0.02;
  scene.add(soleil);

  // Ombre portée sur le « bureau »
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.22 }));
  sol.rotation.x = -PI / 2;
  sol.receiveShadow = true;
  scene.add(sol);

  /* ---------------- Le livre ---------------- */
  const indigo = mat(0x2e2a8c, { r: 0.55 });
  const tranche = (() => {
    const [c, ctx] = canvas(64, 64);
    ctx.fillStyle = "#f4efe2";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#d9d1bd";
    for (let y = 0; y < 64; y += 4) ctx.fillRect(0, y, 64, 1);
    const t = texture(c, renderer);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 6);
    return mat(0xffffff, { map: t, r: 0.9 });
  })();
  const blanc = mat(0xf7f2e6, { r: 0.9 });
  const mats = [tranche, tranche, blanc, blanc, tranche, tranche];

  const couvR = box(PW + 0.14, 0.08, PD + 0.26, indigo);
  couvR.position.set(PW / 2 + 0.05, 0.04, 0);
  const couvL = couvR.clone();
  couvL.position.x = -PW / 2 - 0.05;
  const pileR = new THREE.Mesh(new THREE.BoxGeometry(PW, PY - 0.08, PD), mats);
  pileR.position.set(PW / 2, 0.08 + (PY - 0.08) / 2, 0);
  pileR.castShadow = pileR.receiveShadow = true;
  const pileL = pileR.clone();
  pileL.position.x = -PW / 2;
  scene.add(couvR, couvL, pileR, pileL);

  const planPage = new THREE.PlaneGeometry(PW, PD);
  const pageL = new THREE.Mesh(planPage, mat(0xffffff, { r: 0.92 }));
  pageL.rotation.x = -PI / 2;
  pageL.position.set(-PW / 2, PY + 0.002, 0);
  pageL.receiveShadow = true;
  const pageR = pageL.clone();
  pageR.material = mat(0xffffff, { r: 0.92 });
  pageR.position.x = PW / 2;
  scene.add(pageL, pageR);

  const texG = CHAPITRES.map((ch, i) => pageGauche(renderer, ch, 2 * i + 2));
  const texD = CHAPITRES.map((ch, i) => pageDroite(renderer, ch, 2 * i + 3));
  const texCouv = couverture(renderer);

  /* Feuille qui tourne (géométrie courbée recalculée à chaque image) */
  const NX = 30, NZ = 2;
  function feuille(largeur, profondeur) {
    const n = (NX + 1) * (NZ + 1);
    const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const uvA = new Float32Array(n * 2), uvB = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i <= NX; i++)
      for (let j = 0; j <= NZ; j++) {
        const k = i * (NZ + 1) + j;
        uvA[2 * k] = i / NX; uvA[2 * k + 1] = j / NZ;
        uvB[2 * k] = 1 - i / NX; uvB[2 * k + 1] = j / NZ;
      }
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NZ; j++) {
        const a = i * (NZ + 1) + j, b = (i + 1) * (NZ + 1) + j, c = a + 1, d = b + 1;
        idx.push(a, b, c, b, d, c);
      }
    const gA = new THREE.BufferGeometry(), gB = new THREE.BufferGeometry();
    gA.setAttribute("position", pos);
    gB.setAttribute("position", pos);
    gA.setAttribute("uv", new THREE.BufferAttribute(uvA, 2));
    gB.setAttribute("uv", new THREE.BufferAttribute(uvB, 2));
    gA.setIndex(idx);
    gB.setIndex(idx);
    const recto = new THREE.Mesh(gA, mat(0xffffff, { r: 0.9 }));
    const verso = new THREE.Mesh(gB, mat(0xffffff, { r: 0.9, side: THREE.BackSide }));
    recto.castShadow = verso.castShadow = true;
    const g = new THREE.Group();
    g.add(recto, verso);
    g.visible = false;
    scene.add(g);
    return {
      g, recto, verso,
      poser(theta, sens, y0) {
        const seg = largeur / NX;
        let x = 0, y = 0;
        const arr = pos.array;
        for (let i = 0; i <= NX; i++) {
          if (i > 0) {
            const s = (i - 0.5) / NX;
            const a = clamp(theta + sens * 0.9 * Math.sin(theta) * s, 0, PI);
            x += Math.cos(a) * seg;
            y += Math.sin(a) * seg;
          }
          for (let j = 0; j <= NZ; j++) {
            const k = 3 * (i * (NZ + 1) + j);
            arr[k] = x;
            arr[k + 1] = y0 + y;
            arr[k + 2] = (0.5 - j / NZ) * profondeur;
          }
        }
        pos.needsUpdate = true;
        gA.computeVertexNormals();
        gB.setAttribute("normal", gA.getAttribute("normal"));
        gA.computeBoundingSphere();
        gB.boundingSphere = gA.boundingSphere;
      },
    };
  }
  const page = feuille(PW, PD);
  const couv = feuille(PW + 0.14, PD + 0.26);
  couv.recto.material = mat(0xffffff, { map: texCouv, r: 0.5 });

  /* ---------------- Scènes pop-up ---------------- */
  const hotspots = []; // {chapitre, kicker, titre, texte, url, meshes, ancre, sprite}
  const texPastille = pastille(renderer);

  function creerScene(chIndex) {
    const groupe = new THREE.Group();
    groupe.visible = false;
    scene.add(groupe);
    const S = {
      groupe, pieces: [], anim: [], p: 0,
      piece(o) {
        const pivot = new THREE.Group();
        pivot.position.set(o.x, PY, o.z);
        pivot.rotation.y = o.ry ?? 0;
        const inner = new THREE.Group();
        pivot.add(inner);
        groupe.add(pivot);
        S.pieces.push({ pivot, inner, delai: o.delai ?? 0, incl: o.incl ?? 0, mode: o.mode ?? "plier", y: o.y ?? 0 });
        // languette de papier collée sous la pièce
        if (o.languette !== false) {
          const l = new THREE.Mesh(new THREE.PlaneGeometry(o.languette ?? 0.9, 0.22), mat(0xffffff, { r: 0.95 }));
          l.rotation.x = -PI / 2;
          l.position.set(o.x, PY + 0.004, o.z + 0.08);
          l.rotation.z = -(o.ry ?? 0);
          l.receiveShadow = true;
          groupe.add(l);
        }
        return inner;
      },
      zone(info, objet, ancre, haut = 0.35) {
        const h = { chapitre: chIndex, ...info, meshes: [], ancre: ancre ?? objet, haut };
        objet.traverse((m) => {
          if (m.isMesh) {
            m.userData.hotspot = h;
            h.meshes.push(m);
          }
        });
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texPastille, depthTest: false, transparent: true }));
        sp.scale.setScalar(0.32);
        sp.renderOrder = 10;
        sp.userData.hotspot = h;
        sp.visible = false;
        scene.add(sp);
        h.sprite = sp;
        hotspots.push(h);
        return h;
      },
      tous(fn) { S.anim.push(fn); },
    };
    return S;
  }

  const scenes = CHAPITRES.map((_, i) => creerScene(i));

  /* --- Chapitre 1 : la carte --- */
  (function (S) {
    const pcb = S.piece({ x: 2.1, z: 1.0, incl: -0.5, languette: 2.6 });
    const faceMat = mat(0xffffff, { map: facePCB(renderer), r: 0.55 });
    const vert = mat(0x0f4a3b, { r: 0.6 });
    const carte = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.32, 0.08), [vert, vert, vert, vert, faceMat, vert]);
    carte.castShadow = carte.receiveShadow = true;
    carte.position.set(0, 1.2, 0);
    pcb.add(carte);
    const f = (o) => { o.position.z += 0.04; carte.add(o); return o; };

    // connecteurs au pas de 2,54 mm (décor)
    const noir = mat(0x15161a, { r: 0.4 });
    const or = mat(0xd9b24a, { r: 0.3, m: 0.8 });
    for (const [y, n] of [[-0.85, 18], [0.85, 16]]) {
      const rangée = box(n * 0.12, 0.13, 0.12, noir);
      rangée.position.set(0.2, y, 0.06);
      f(rangée);
      for (let i = 0; i < n; i++) {
        const pin = box(0.03, 0.03, 0.1, or);
        pin.castShadow = false;
        pin.position.set(0.2 - (n * 0.12) / 2 + 0.06 + i * 0.12, y, 0.16);
        f(pin);
      }
    }

    // le microcontrôleur
    const puce = new THREE.Group();
    const corps = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), [noir, noir, noir, noir, mat(0xffffff, { map: dessusPuce(renderer), r: 0.5 }), noir]);
    corps.castShadow = true;
    puce.add(corps);
    for (let i = -4; i <= 4; i++)
      for (const s of [-1, 1]) {
        const a = box(0.04, 0.08, 0.02, or);
        a.position.set(i * 0.085, s * 0.44, -0.03);
        const b = box(0.08, 0.04, 0.02, or);
        b.position.set(s * 0.44, i * 0.085, -0.03);
        puce.add(a, b);
      }
    puce.position.set(-0.15, 0.05, 0.06);
    f(puce);
    const coinPuce = new THREE.Object3D(); // la pastille de la puce, à côté du NPU
    coinPuce.position.set(-0.55, -0.3, 0.1);
    puce.add(coinPuce);
    S.zone({ kicker: "Cours 1", titre: "Le microcontrôleur MCX N947", texte: "Deux cœurs Arm Cortex-M33 à 150 MHz, 2 Mo de Flash et 512 Ko de SRAM : le cerveau de la carte. Le cours 1 présente ses blocs, sa mémoire, ses broches et la chaîne d'outils.", url: LIENS.cours1 }, puce, coinPuce, 0);

    // le NPU, « éclaté » au-dessus de la puce
    const npu = new THREE.Group();
    const cubes = [];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const m = mat(0x7b6cff, { e: 0x5b4bff, ei: 0.6, r: 0.3 });
        const c = box(0.11, 0.11, 0.11, m);
        c.position.set((i - 1.5) * 0.15, (j - 1.5) * 0.15, 0);
        npu.add(c);
        cubes.push(c);
      }
    const cadre = box(0.68, 0.68, 0.02, mat(0x2b2470, { transparent: true, opacity: 0.6 }));
    cadre.position.z = -0.08;
    npu.add(cadre);
    npu.position.set(-0.15, 0.05, 0.75);
    f(npu);
    const fils = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        [-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34],
      ].flatMap(([x, y]) => [new THREE.Vector3(x - 0.15, y + 0.05, 0.13), new THREE.Vector3(x - 0.15, y + 0.05, 0.71)])),
      new THREE.LineBasicMaterial({ color: 0x7b6cff, transparent: true, opacity: 0.7 })
    );
    carte.add(fils);
    S.zone({ kicker: "Cours 2", titre: "Le NPU eIQ Neutron", texte: "Intégré à la puce, il calcule les couches du réseau de neurones en parallèle, en entiers 8 bits. Le cours 2 explique son architecture et pourquoi il va bien plus vite que le CPU.", url: LIENS.cours2 }, npu, cadre, 0.5);
    S.tous((t) => {
      cubes.forEach((c, k) => {
        const v = 0.5 + 0.5 * Math.sin(t * 4 - k * 0.45);
        c.scale.z = 0.6 + v * 1.4;
        c.material.emissiveIntensity = 0.25 + v * 0.9;
      });
    });

    // LED RGB
    const ledMat = mat(0xff3030, { e: 0xff0000, ei: 1.5, r: 0.2 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), ledMat);
    led.position.set(1.45, -0.55, 0.06);
    const ledBase = box(0.22, 0.22, 0.06, mat(0xeeeeee));
    ledBase.position.set(1.45, -0.55, 0.02);
    const ledG = new THREE.Group();
    ledG.add(ledBase, led);
    f(ledG);
    const halo = new THREE.PointLight(0xff0000, 0.8, 1.6);
    halo.position.set(1.45, -0.55, 0.3);
    carte.add(halo);
    const couleursLED = [0xff2020, 0x20ff40, 0x3060ff];
    S.tous((t) => {
      const c = couleursLED[Math.floor(t / 0.8) % 3];
      ledMat.color.setHex(c);
      ledMat.emissive.setHex(c);
      halo.color.setHex(c);
    });
    S.zone({ kicker: "TD1", titre: "La LED RGB", texte: "Trois LED (rouge, verte, bleue) reliées à des broches GPIO, actives à l'état bas. Le TD1 commence par les faire clignoter, puis les combine.", url: LIENS.td1 }, ledG, led, 0.25);

    // boutons SW2 et SW3
    const btns = new THREE.Group();
    const capots = [];
    for (const x of [-1.5, -1.05]) {
      const b = box(0.26, 0.26, 0.08, mat(0xc9ccd4, { m: 0.6, r: 0.35 }));
      b.position.set(x, -0.6, 0.02);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 20), mat(0x2b2b33));
      cap.rotation.x = PI / 2;
      cap.position.set(x, -0.6, 0.1);
      cap.castShadow = true;
      btns.add(b, cap);
      capots.push(cap);
    }
    f(btns);
    S.tous((t) => capots.forEach((c, k) => (c.position.z = 0.1 - (Math.sin(t * 3 + k * 1.6) > 0.85 ? 0.04 : 0))));
    S.zone({ kicker: "TD1", titre: "Les boutons SW2 et SW3", texte: "Deux boutons utilisateur, lus par interruption dans le TD1. Le TP3 s'en sert pour passer d'une image de test à l'autre.", url: LIENS.td1 }, btns, capots[0], 0.3);

    // USB MCU-Link
    const argent = mat(0xc0c4cc, { m: 0.85, r: 0.3 });
    const usb = box(0.42, 0.2, 0.18, argent);
    usb.position.set(-1.3, 1.08, 0.08);
    f(usb);
    const usb2 = box(0.42, 0.2, 0.18, argent);
    usb2.position.set(1.2, 1.08, 0.08);
    f(usb2);
    S.zone({ kicker: "TP1", titre: "Le port USB MCU-Link", texte: "C'est par lui qu'on flashe le programme et qu'on lit le terminal série (115200 bauds). Le TP1 l'utilise pour afficher le résultat de la classification.", url: LIENS.tp1 }, usb, usb, 0.25);
  })(scenes[0]);

  /* --- Chapitre 2 : les cours --- */
  (function (S) {
    const violet = 0x6c5ce7;
    const socle = (w, h, d, c = 0xffffff) => box(w, h, d, mat(c, { r: 0.9 }));

    // Cours 1 : la carte (une petite puce sur un socle)
    const c1 = S.piece({ x: 0.95, z: 1.5, incl: 0, delai: 0 });
    const s1 = socle(0.9, 0.5, 0.9);
    s1.position.y = 0.25;
    const puce = box(0.5, 0.08, 0.5, mat(0x1b1c22, { r: 0.4 }));
    puce.position.y = 0.54;
    const pattes = new THREE.Group();
    for (let i = -2; i <= 2; i++)
      for (const s of [-1, 1]) {
        const a = box(0.04, 0.02, 0.1, mat(0xd9b24a, { m: 0.8, r: 0.3 }));
        a.position.set(i * 0.09, 0.52, s * 0.29);
        const b = a.clone();
        b.rotation.y = PI / 2;
        b.position.set(s * 0.29, 0.52, i * 0.09);
        pattes.add(a, b);
      }
    const e1 = etiquette(renderer, ["Cours 1", "La carte"], { couleur: "#6c5ce7", largeur: 1.1 });
    e1.position.set(0, 1.05, -0.35);
    const g1 = new THREE.Group();
    g1.add(s1, puce, pattes, e1);
    c1.add(g1);
    S.tous((t) => (puce.rotation.y = t * 0.6));
    S.zone({ kicker: "Cours 1", titre: "Initiation à la carte FRDM-MCXN947", texte: "Le microcontrôleur MCX N947, sa mémoire, ses broches GPIO et la chaîne d'outils (MCUXpresso IDE, SDK, débogueur MCU-Link).", url: LIENS.cours1 }, g1, e1, 0.45);

    // Cours 2 : le NPU, une grille d'unités de calcul qui travaillent en vagues
    const c2 = S.piece({ x: 2.3, z: -0.5, delai: 0.12 });
    const s2 = socle(1.6, 0.18, 1.6);
    s2.position.y = 0.09;
    const g2 = new THREE.Group();
    g2.add(s2);
    const macs = [];
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        const m = box(0.18, 0.18, 0.18, mat(violet, { e: 0x4a3aff, ei: 0.4, r: 0.35 }));
        m.position.set((i - 2.5) * 0.24, 0.27, (j - 2.5) * 0.24);
        g2.add(m);
        macs.push(m);
      }
    const e2 = etiquette(renderer, ["Cours 2", "Le NPU"], { couleur: "#6c5ce7", largeur: 1.2 });
    e2.position.set(0, 1.3, -0.9);
    g2.add(e2);
    c2.add(g2);
    S.tous((t) => {
      macs.forEach((m, k) => {
        const i = Math.floor(k / 6), j = k % 6;
        const v = 0.5 + 0.5 * Math.sin(t * 3.2 - (i + j) * 0.55);
        m.scale.y = 0.4 + v * 2.2;
        m.position.y = 0.18 + 0.09 * m.scale.y;
        m.material.emissiveIntensity = 0.15 + v;
      });
    });
    S.zone({ kicker: "Cours 2", titre: "Les architectures NPU", texte: "Pourquoi un accélérateur dédié ? Des dizaines d'unités multiplient-accumulent en même temps, en entiers 8 bits, au plus près de la mémoire. Le cours 2 démonte le NPU eIQ Neutron.", url: LIENS.cours2 }, g2, e2, 0.45);

    // Cours 3 : la chaîne eIQ, un escalier de quatre marches
    const c3 = S.piece({ x: 3.35, z: 1.55, delai: 0.24, ry: -0.35 });
    const g3 = new THREE.Group();
    const etapes = [["Données", 0x9b8cff], ["Entraîner", 0x8573ff], ["int8", 0x6c5ce7], ["NPU", 0x4b3cc9]];
    const marches = [];
    etapes.forEach(([nom, c], k) => {
      const m = box(0.34, 0.2 + k * 0.22, 0.6, mat(c, { r: 0.6 }));
      m.position.set(-0.54 + k * 0.36, (0.2 + k * 0.22) / 2, 0);
      g3.add(m);
      marches.push(m);
      const l = etiquette(renderer, [nom], { couleur: "#2e2a8c", largeur: 0.42, w: 320, h: 110, taille: 54 });
      l.position.set(-0.54 + k * 0.36, 0.3 + k * 0.22 + 0.12, 0.31);
      g3.add(l);
    });
    const bille = new THREE.Mesh(new THREE.SphereGeometry(0.08, 18, 12), mat(0xffc93c, { e: 0xffa000, ei: 0.6 }));
    bille.castShadow = true;
    g3.add(bille);
    const e3 = etiquette(renderer, ["Cours 3", "La chaîne eIQ"], { couleur: "#6c5ce7", largeur: 1.2 });
    e3.position.set(0, 1.45, -0.35);
    g3.add(e3);
    c3.add(g3);
    S.tous((t) => {
      const u = (t * 0.5) % 1, k = Math.min(3, Math.floor(u * 4)), f = u * 4 - k;
      bille.position.set(-0.54 + (k + f) * 0.36 - 0.18 * 0, 0.2 + k * 0.22 + 0.08 + Math.sin(f * PI) * 0.25, 0);
    });
    S.zone({ kicker: "Cours 3", titre: "La chaîne eIQ, de l'apprentissage au NPU", texte: "Les données, l'entraînement, la quantification en int8 puis la conversion pour le NPU : le chemin complet d'un modèle, du PC jusqu'à la carte.", url: LIENS.cours3 }, g3, e3, 0.45);
  })(scenes[1]);

  /* --- Chapitre 3 : TD1 --- */
  (function (S) {
    // la LED géante
    const p1 = S.piece({ x: 1.0, z: 0.4, delai: 0 });
    const g1 = new THREE.Group();
    const pied = box(0.7, 0.5, 0.7, mat(0xffffff, { r: 0.9 }));
    pied.position.y = 0.25;
    const domeMat = mat(0xff2020, { e: 0xff0000, ei: 1.2, r: 0.15, transparent: true, opacity: 0.92 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 20, 0, 2 * PI, 0, PI / 2), domeMat);
    dome.position.y = 0.5;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 32), domeMat);
    cyl.position.y = 0.38;
    dome.castShadow = cyl.castShadow = true;
    const lum = new THREE.PointLight(0xff0000, 2, 3);
    lum.position.y = 1.0;
    const e1 = etiquette(renderer, ["TD1", "LED RGB"], { couleur: "#00a99d", largeur: 1.0 });
    e1.position.set(0, 1.25, -0.2);
    g1.add(pied, dome, cyl, lum, e1);
    p1.add(g1);
    let couleur = 0;
    const palette = [0xff2020, 0x20e040, 0x3060ff];
    S.tous((t) => {
      const allume = (t % 0.9) < 0.6;
      const c = palette[couleur];
      domeMat.color.setHex(allume ? c : 0x555560);
      domeMat.emissive.setHex(allume ? c : 0x000000);
      lum.intensity = allume ? 2 : 0;
      lum.color.setHex(c);
    });
    S.zone({ kicker: "TD1", titre: "Faire clignoter la LED RGB", texte: "Parties 1 et 2 du TD1 : partir de l'exemple gpio_led_output du SDK, faire clignoter la LED rouge, puis piloter les trois couleurs.", url: LIENS.td1 }, g1, e1, 0.4);

    // les boutons : un appui change la couleur de la LED
    const p2 = S.piece({ x: 1.0, z: 2.1, delai: 0.12, languette: 1.3 });
    const g2 = new THREE.Group();
    const caps = [];
    [-0.35, 0.35].forEach((x, k) => {
      const b = box(0.5, 0.18, 0.5, mat(0xc9ccd4, { m: 0.6, r: 0.35 }));
      b.position.set(x, 0.09, 0);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 28), mat(k ? 0x2b2b33 : 0x2b2b33));
      cap.position.set(x, 0.24, 0);
      cap.castShadow = true;
      const l = etiquette(renderer, [k ? "SW3" : "SW2"], { couleur: "#00a99d", largeur: 0.42, w: 300, h: 120, taille: 64 });
      l.rotation.x = -PI / 2.6;
      l.position.set(x, 0.12, 0.42);
      g2.add(b, cap, l);
      caps.push(cap);
    });
    p2.add(g2);
    let dernier = -1;
    S.tous((t) => {
      const cycle = Math.floor(t / 1.8);
      const phase = (t / 1.8) % 1;
      const k = cycle % 2;
      caps.forEach((c, i) => (c.position.y = 0.24 - (i === k && phase < 0.15 ? 0.07 : 0)));
      if (cycle !== dernier) {
        dernier = cycle;
        couleur = (couleur + 1) % 3;
      }
    });
    S.zone({ kicker: "TD1", titre: "Réagir aux boutons", texte: "Partie 3 du TD1 : l'exemple gpio_input_interrupt. Un appui sur SW2 ou SW3 déclenche une interruption, et la LED change d'état.", url: LIENS.td1 }, g2, caps[0], 0.3);

    // les tâches FreeRTOS : trois colonnes qui s'allument à leur période
    const p3 = S.piece({ x: 3.05, z: 0.9, delai: 0.24, languette: 1.8 });
    const g3 = new THREE.Group();
    const fond = box(1.9, 1.7, 0.06, mat(0xffffff, { r: 0.9 }));
    fond.position.set(0, 0.85, -0.45);
    g3.add(fond);
    const taches = [["STAB", 0.5, 0x00a99d], ["NAV", 1.0, 0x2e86de], ["TELEM", 2.0, 0x8e44ad]];
    const cols = [];
    taches.forEach(([nom, periode, c], k) => {
      const x = (k - 1) * 0.6;
      const m = mat(c, { e: c, ei: 0.2, r: 0.5 });
      const col = box(0.36, 1, 0.36, m);
      col.position.set(x, 0.5, 0);
      g3.add(col);
      const l = etiquette(renderer, [nom], { couleur: "#1f2433", largeur: 0.5, w: 320, h: 110, taille: 56 });
      l.position.set(x, 0.12, 0.25);
      g3.add(l);
      const lp = etiquette(renderer, [`${periode * 1000} ms`], { couleur: "#6a6f82", largeur: 0.46, w: 320, h: 110, taille: 52 });
      lp.position.set(x, 1.45, -0.4);
      g3.add(lp);
      cols.push({ col, m, periode });
    });
    p3.add(g3);
    S.tous((t) => {
      cols.forEach(({ col, m, periode }) => {
        const ph = (t % periode) / periode;
        const actif = ph < 0.18;
        const h = actif ? 1.25 : 0.55;
        col.scale.y += (h - col.scale.y) * 0.25;
        col.position.y = col.scale.y / 2;
        m.emissiveIntensity = actif ? 0.9 : 0.1;
      });
    });
    S.zone({ kicker: "TD1", titre: "Les tâches FreeRTOS d'un drone", texte: "Partie 4 du TD1 : trois tâches de priorités différentes (stabilisation toutes les 500 ms, navigation toutes les 1000 ms, télémétrie toutes les 2000 ms) et l'ordonnanceur qui les départage.", url: LIENS.td1 }, g3, fond, 0.95);
  })(scenes[2]);

  /* --- Chapitre 4 : les TP --- */
  (function (S) {
    // TP1 : une photo classée par le NPU
    const p1 = S.piece({ x: 0.95, z: 0.3, delai: 0, incl: -0.15, languette: 1.3 });
    const g1 = new THREE.Group();
    const cadre = box(1.3, 1.07, 0.05, mat(0x2e2a8c, { r: 0.6 }));
    cadre.position.y = 0.68;
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.98), mat(0xffffff, { map: photoPizza(renderer), r: 0.8 }));
    photo.position.set(0, 0.68, 0.03);
    const e1 = etiquette(renderer, ["TP1", "Classer une image"], { couleur: "#e08a00", largeur: 1.2 });
    e1.position.set(0, 1.55, -0.05);
    g1.add(cadre, photo, e1);
    p1.add(g1);
    S.tous((t) => (photo.position.z = 0.03 + Math.sin(t * 2) * 0.005));
    S.zone({ kicker: "TP1", titre: "Classification d'images sur NPU", texte: "Importer l'exemple label_image, le flasher, changer l'image à classer, puis comparer le même réseau exécuté sur le CPU et sur le NPU.", url: LIENS.tp1 }, g1, e1, 0.4);

    // TP2 : un bouquet des cinq classes de fleurs
    const p2 = S.piece({ x: 2.25, z: 1.75, delai: 0.12, mode: "ressort", languette: 1.2 });
    const g2 = new THREE.Group();
    const tige = mat(0x3d8b3d, { r: 0.7 });
    const fleurs = [];
    const types = [
      { x: -0.45, h: 0.9, tete: "tournesol" },
      { x: -0.2, h: 1.15, tete: "tulipe" },
      { x: 0.05, h: 1.0, tete: "rose" },
      { x: 0.3, h: 1.2, tete: "marguerite" },
      { x: 0.55, h: 0.85, tete: "pissenlit" },
    ];
    for (const ty of types) {
      const f = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, ty.h, 8), tige);
      t.position.y = ty.h / 2;
      t.castShadow = true;
      f.add(t);
      const tete = new THREE.Group();
      tete.position.y = ty.h;
      if (ty.tete === "tournesol" || ty.tete === "marguerite") {
        const n = 12, coul = ty.tete === "tournesol" ? 0xffc21a : 0xffffff;
        for (let i = 0; i < n; i++) {
          const pet = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(coul, { r: 0.6 }));
          pet.scale.set(1, 0.35, 2.2);
          const a = (i / n) * 2 * PI;
          pet.position.set(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
          pet.rotation.y = -a + PI / 2;
          pet.castShadow = true;
          tete.add(pet);
        }
        const coeur = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), mat(ty.tete === "tournesol" ? 0x5a3412 : 0xffd23c));
        coeur.scale.y = 0.5;
        tete.add(coeur);
        tete.rotation.x = 1.0;
      } else if (ty.tete === "tulipe") {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10, 0, 2 * PI, 0, PI * 0.75), mat(0xe8344e, { side: THREE.DoubleSide }));
        b.rotation.x = PI;
        b.scale.y = 1.5;
        b.position.y = 0.08;
        b.castShadow = true;
        tete.add(b);
      } else if (ty.tete === "rose") {
        for (let i = 0; i < 5; i++) {
          const pet = new THREE.Mesh(new THREE.SphereGeometry(0.1 - i * 0.015, 12, 10), mat(i % 2 ? 0xd9416b : 0xf06292, { r: 0.5 }));
          pet.position.y = i * 0.02;
          pet.scale.y = 0.7;
          pet.castShadow = true;
          tete.add(pet);
        }
      } else {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), mat(0xf5f5f0, { r: 1, transparent: true, opacity: 0.85 }));
        puff.castShadow = true;
        tete.add(puff);
      }
      f.add(tete);
      f.position.x = ty.x;
      g2.add(f);
      fleurs.push(f);
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.3, 28), mat(0xffffff, { r: 0.9 }));
    pot.position.y = 0.15;
    pot.castShadow = true;
    g2.add(pot);
    const e2 = etiquette(renderer, ["TP2", "Fleurs"], { couleur: "#e08a00", largeur: 0.9 });
    e2.position.set(0, 0.2, 0.62);
    e2.rotation.x = -0.4;
    g2.add(e2);
    p2.add(g2);
    S.tous((t) => fleurs.forEach((f, k) => (f.rotation.z = Math.sin(t * 1.4 + k) * 0.07)));
    S.zone({ kicker: "TP2", titre: "Entraîner son modèle avec eIQ Portal", texte: "Cinq classes de fleurs, un modèle entraîné dans eIQ Portal, quantifié en int8, converti pour le NPU puis testé sur la carte.", url: LIENS.tp2 }, g2, e2, 0.3);

    // TP3 : un feu de camp et la LED d'alerte
    const p3 = S.piece({ x: 3.4, z: 0.4, delai: 0.24, languette: 1.2 });
    const g3 = new THREE.Group();
    const bois = mat(0x6b3f1d, { r: 0.8 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 10), bois);
      b.rotation.z = PI / 2;
      b.rotation.y = (i / 4) * PI;
      b.position.y = 0.06;
      b.castShadow = true;
      g3.add(b);
    }
    const flammes = [];
    [[0, 0.5, 0xff7a00], [0.1, 0.36, 0xffb000], [-0.1, 0.38, 0xff5000], [0, 0.26, 0xffe066]].forEach(([x, h, c]) => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.13 * (h / 0.5) + 0.04, h, 14), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
      f.position.set(x, 0.08 + h / 2, (x ? 0.05 : 0));
      g3.add(f);
      flammes.push({ f, h });
    });
    const feuLum = new THREE.PointLight(0xff7a00, 2.5, 3);
    feuLum.position.y = 0.6;
    g3.add(feuLum);
    // poteau avec la LED d'alerte
    const poteau = box(0.08, 0.9, 0.08, mat(0x9aa0ad, { m: 0.4 }));
    poteau.position.set(0.6, 0.45, -0.1);
    const alerteMat = mat(0xff2020, { e: 0xff0000, ei: 1.5 });
    const alerte = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), alerteMat);
    alerte.position.set(0.6, 0.98, -0.1);
    const e3 = etiquette(renderer, ["TP3", "Détecter un feu"], { couleur: "#e08a00", largeur: 1.15 });
    e3.position.set(0, 1.4, -0.3);
    g3.add(poteau, alerte, e3);
    p3.add(g3);
    S.tous((t) => {
      flammes.forEach(({ f }, k) => {
        f.scale.y = 0.85 + 0.25 * Math.abs(Math.sin(t * (7 + k) + k));
        f.scale.x = f.scale.z = 0.9 + 0.12 * Math.sin(t * (5 + k));
      });
      feuLum.intensity = 2 + Math.sin(t * 11) * 0.5;
      const on = t % 0.6 < 0.3;
      alerteMat.emissiveIntensity = on ? 2 : 0.1;
      alerteMat.color.setHex(on ? 0xff2020 : 0x662222);
    });
    S.zone({ kicker: "TP3", titre: "Détecter un feu sur le NPU", texte: "Deux classes (feu, pas de feu), le compromis entre feux manqués et fausses alarmes, une LED d'alerte rouge ou verte et le bouton SW2 pour tester plusieurs images.", url: LIENS.tp3 }, g3, e3, 0.4);
  })(scenes[3]);

  /* --- Chapitre 5 : le projet --- */
  (function (S) {
    // l'autoroute en diagonale (trajectoire y = x)
    const p1 = S.piece({ x: 2.1, z: 0.1, mode: "ressort", languette: false });
    const route = new THREE.Group();
    const L = 4.3;
    const asphalte = box(L, 0.06, 0.95, mat(0x3a3d46, { r: 0.9 }));
    asphalte.position.y = 0.03;
    route.add(asphalte);
    for (let i = 0; i < 12; i++) {
      const tiret = box(0.22, 0.01, 0.03, mat(0xffffff));
      tiret.position.set(-L / 2 + 0.25 + i * 0.42, 0.065, 0);
      tiret.castShadow = false;
      route.add(tiret);
    }
    for (const s of [-1, 1]) {
      const gl = box(L, 0.08, 0.03, mat(0xbfc4cc, { m: 0.5 }));
      gl.position.set(0, 0.1, s * 0.5);
      route.add(gl);
    }
    const voiture = (c) => {
      const v = new THREE.Group();
      const caisse = box(0.32, 0.1, 0.17, mat(c, { r: 0.4 }));
      caisse.position.y = 0.11;
      const toit = box(0.17, 0.08, 0.15, mat(c, { r: 0.4 }));
      toit.position.set(-0.02, 0.2, 0);
      v.add(caisse, toit);
      return v;
    };
    // voie de droite : la circulation roule ; voie de gauche : bouchon derrière l'accident
    const flux = [];
    [[0x27ae60, 0], [0xecf0f1, 0.5]].forEach(([c, o]) => {
      const v = voiture(c);
      v.position.z = 0.22;
      v.rotation.y = PI;
      route.add(v);
      flux.push({ v, o });
    });
    [[0x2e86de, -0.05], [0xf1c40f, -0.5], [0x95a5a6, -0.95]].forEach(([c, x]) => {
      const v = voiture(c);
      v.position.set(x, 0, -0.22);
      route.add(v);
    });
    // l'accident
    const a1 = voiture(0xd63c2f);
    a1.position.set(0.4, 0, -0.2);
    a1.rotation.y = 0.9;
    const a2 = voiture(0x8e44ad);
    a2.position.set(0.68, 0, -0.12);
    a2.rotation.y = -0.5;
    const feuxDetresse = mat(0xffa000, { e: 0xffa000, ei: 1.5 });
    const fd = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), feuxDetresse);
    fd.position.set(0.55, 0.3, -0.16);
    route.add(a1, a2, fd);
    route.rotation.y = 0.85;
    p1.add(route);
    S.tous((t) => {
      flux.forEach(({ v, o }) => {
        const u = (t * 0.12 + o) % 1;
        v.position.x = L / 2 - 0.2 - u * (L - 0.4);
      });
      feuxDetresse.emissiveIntensity = t % 0.5 < 0.25 ? 2.2 : 0;
    });
    S.zone({ kicker: "Projet", titre: "L'autoroute surveillée", texte: "Le drone suit la trajectoire de l'autoroute en aller-retour, analyse les images, et signale tout accident avec sa position et le score du réseau de neurones.", url: LIENS.projet1 }, route, asphalte, 0.3);

    // trois drones
    const drones = [];
    const p2 = S.piece({ x: 2.1, z: 0.1, mode: "envol", languette: false });
    const flotte = new THREE.Group();
    flotte.rotation.y = 0.85;
    p2.add(flotte);
    const ondes = [];
    for (let k = 0; k < 3; k++) {
      const d = new THREE.Group();
      const corps = box(0.24, 0.08, 0.24, mat(0xf5f6fa, { r: 0.4 }));
      d.add(corps);
      const helices = [];
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const bras = box(0.24, 0.025, 0.03, mat(0x2b2b33));
        bras.position.set(x * 0.12, 0, z * 0.12);
        bras.rotation.y = Math.atan2(z, x) * -1;
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 20), mat(0x2e2a8c, { transparent: true, opacity: 0.55 }));
        h.position.set(x * 0.2, 0.05, z * 0.2);
        d.add(bras, h);
        helices.push(h);
      }
      const ledMat = mat(0x20e040, { e: 0x20e040, ei: 1.5 });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), ledMat);
      led.position.y = -0.06;
      d.add(led);
      const cam = box(0.07, 0.07, 0.07, mat(0x15161a));
      cam.position.set(0.1, -0.07, 0);
      d.add(cam);
      d.position.y = 1.2;
      flotte.add(d);
      const onde = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 8, 48), new THREE.MeshBasicMaterial({ color: 0xd63c2f, transparent: true, opacity: 0 }));
      onde.rotation.x = PI / 2;
      flotte.add(onde);
      ondes.push(onde);
      drones.push({ d, helices, ledMat, o: k / 3 });
    }
    const e = etiquette(renderer, ["Projet", "Flotte de drones"], { couleur: "#d63c2f", largeur: 1.25 });
    e.position.set(-1.0, 0.75, -1.75);
    p2.add(e);
    S.tous((t) => {
      drones.forEach(({ d, helices, ledMat, o }, k) => {
        const u = (t * 0.07 + o) % 1;
        const x = Math.sin(u * 2 * PI) * 1.75; // aller-retour le long de la route
        d.position.x = x;
        d.position.z = (k - 1) * 0.12;
        d.position.y = 1.15 + Math.sin(t * 2 + k) * 0.05;
        d.rotation.y = Math.cos(u * 2 * PI) > 0 ? 0 : PI;
        helices.forEach((h, i) => (h.rotation.y = t * 30 + i));
        const surAccident = Math.abs(x - 0.55) < 0.35;
        ledMat.color.setHex(surAccident ? 0xff2020 : 0x20e040);
        ledMat.emissive.setHex(surAccident ? 0xff2020 : 0x20e040);
        const onde = ondes[k];
        if (surAccident) {
          const r = (t * 1.5) % 1;
          onde.position.set(x, d.position.y, d.position.z);
          onde.scale.setScalar(0.5 + r * 3);
          onde.material.opacity = 0.8 * (1 - r);
        } else onde.material.opacity = Math.max(0, onde.material.opacity - 0.02);
      });
    });
    S.zone({ kicker: "Projet", titre: "Flotte de drones de détection d'accidents", texte: "Chaque drone embarque une FRDM-MCXN947 : le NPU classe les images (accident ou pas), une super-boucle non bloquante gère le vol et la radio, et l'alerte part vers les drones voisins.", url: LIENS.projet1 }, flotte, drones[1].d, 0.3);
    S.zone({ kicker: "Projet", titre: "Le message d'alerte", texte: "Quand un drone voit l'accident, sa LED passe au rouge et il diffuse un message radio avec son identifiant, sa position et le score de détection.", url: LIENS.projet1 }, e, e, 0.4);
  })(scenes[4]);

  /* ---------------- Mise à jour des pièces pop-up ---------------- */
  function poserScene(S) {
    S.groupe.visible = S.p > 0.002;
    for (const pc of S.pieces) {
      const l = clamp((S.p - pc.delai) / (1 - pc.delai));
      const e = l <= 0 ? 0 : easeOutBack(l);
      if (pc.mode === "plier") {
        pc.inner.rotation.x = lerp(-PI / 2 + 0.03, pc.incl, e);
      } else if (pc.mode === "ressort") {
        pc.inner.scale.set(Math.max(e, 0.001), Math.max(e, 0.001), Math.max(e, 0.001));
      } else if (pc.mode === "envol") {
        pc.inner.position.y = (1 - clamp(e, 0, 1.2)) * 3;
        pc.inner.scale.setScalar(Math.max(clamp(l * 2), 0.001));
      }
    }
  }

  /* ---------------- Animations (tweens) ---------------- */
  const tweens = [];
  function tween(duree, fn) {
    return new Promise((res) => tweens.push({ t0: performance.now(), d: duree * 1000 * VITESSE, fn, res }));
  }
  function avancerTweens(now) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      const u = clamp((now - tw.t0) / tw.d);
      tw.fn(u);
      if (u >= 1) {
        tweens.splice(i, 1);
        tw.res();
      }
    }
  }

  /* ---------------- Navigation ---------------- */
  let courant = -1; // -1 = livre fermé
  let occupe = false;

  function etatFerme(ferme) {
    couvL.visible = pileL.visible = pageL.visible = !ferme;
  }
  function textures(g, d) {
    pageL.material.map = g; pageL.material.needsUpdate = true;
    pageR.material.map = d; pageR.material.needsUpdate = true;
  }
  etatFerme(true);
  couv.g.visible = true;
  couv.poser(0, 1, PY + 0.012);
  textures(texG[0], texD[0]);

  function vue(de, vers, u) {
    controls.target.lerpVectors(de.cible, vers.cible, u);
    camera.position.lerpVectors(de.cam, vers.cam, u);
  }

  async function plier(i, ouvrir) {
    const S = scenes[i];
    const a = S.p, b = ouvrir ? 1 : 0;
    await tween(ouvrir ? 1.1 : 0.45, (u) => {
      S.p = lerp(a, b, ouvrir ? u : easeInOut(u));
      poserScene(S);
    });
  }

  async function allerA(cible) {
    if (occupe || cible === courant || cible < -1 || cible >= CHAPITRES.length) return;
    occupe = true;
    fermerPanneau();
    majBoutons(cible);
    try {
      if (courant >= 0) await plier(courant, false);
      if (courant === -1) {
        // ouvrir la couverture
        textures(texG[cible], texD[cible]);
        couv.verso.material.map = texG[cible];
        couv.verso.material.needsUpdate = true;
        const vueDe = { cible: controls.target.clone(), cam: camera.position.clone() };
        await tween(1.4, (u) => {
          const e = easeInOut(u);
          couv.poser(e * PI, 1, PY + 0.012);
          vue(vueDe, ajuste(VUE_OUVERT), e);
          if (u > 0.5) etatFerme(false);
        });
        couv.g.visible = false;
      } else if (cible === -1) {
        // refermer
        couv.verso.material.map = texG[courant];
        couv.verso.material.needsUpdate = true;
        couv.g.visible = true;
        const vueDe = { cible: controls.target.clone(), cam: camera.position.clone() };
        await tween(1.3, (u) => {
          const e = easeInOut(u);
          couv.poser(PI - e * PI, -1, PY + 0.012);
          vue(vueDe, ajuste(VUE_FERME), e);
          if (u > 0.5) etatFerme(true);
        });
      } else {
        // tourner une page
        const avant = cible > courant;
        page.recto.material.map = avant ? texD[courant] : texD[cible];
        page.verso.material.map = avant ? texG[cible] : texG[courant];
        page.recto.material.needsUpdate = page.verso.material.needsUpdate = true;
        if (avant) textures(texG[courant], texD[cible]);
        else textures(texG[cible], texD[courant]);
        page.g.visible = true;
        await tween(1.0, (u) => {
          const e = easeInOut(u);
          page.poser(avant ? e * PI : PI - e * PI, avant ? 1 : -1, PY + 0.006);
        });
        textures(texG[cible], texD[cible]);
        page.g.visible = false;
      }
      courant = cible;
      if (courant >= 0) await plier(courant, true);
    } finally {
      occupe = false;
      majBoutons(courant);
    }
  }

  /* ---------------- Interface HTML ---------------- */
  const noms = ["Couverture", ...CHAPITRES.map((c) => c.court)];
  noms.forEach((n, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "livre3d__chip";
    b.textContent = n;
    b.dataset.i = String(k - 1);
    if (k > 0) b.style.setProperty("--chip", CHAPITRES[k - 1].couleur);
    b.addEventListener("click", () => allerA(k - 1));
    chips.appendChild(b);
  });
  function majBoutons(i) {
    btnPrec.disabled = i <= -1;
    btnSuiv.disabled = i >= CHAPITRES.length - 1;
    chips.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", Number(b.dataset.i) === i));
    root.classList.toggle("is-ferme", i === -1);
  }
  majBoutons(-1);
  btnPrec.addEventListener("click", () => allerA(courant - 1));
  btnSuiv.addEventListener("click", () => allerA(courant + 1));
  btnVue.addEventListener("click", () => {
    const de = { cible: controls.target.clone(), cam: camera.position.clone() };
    tween(0.8, (u) => vue(de, ajuste(courant === -1 ? VUE_FERME : VUE_OUVERT), easeInOut(u)));
  });
  btnPlein.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen();
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, [contenteditable]")) return;
    const r = root.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    if (e.key === "ArrowRight") { allerA(courant + 1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { allerA(courant - 1); e.preventDefault(); }
    if (e.key === "Escape") fermerPanneau();
  });

  let actif = null;
  function ouvrirPanneau(h) {
    actif = h;
    const ch = CHAPITRES[h.chapitre];
    panneau.style.setProperty("--accent", ch.couleur);
    panneau.querySelector(".livre3d__kicker").textContent = h.kicker;
    panneau.querySelector(".livre3d__titre").textContent = h.titre;
    panneau.querySelector(".livre3d__texte").textContent = h.texte;
    const a = panneau.querySelector(".livre3d__ouvrir");
    a.href = h.url;
    panneau.hidden = false;
    requestAnimationFrame(() => panneau.classList.add("is-visible"));
  }
  function fermerPanneau() {
    actif = null;
    panneau.classList.remove("is-visible");
    panneau.hidden = true;
  }
  panneau.querySelector(".livre3d__fermer").addEventListener("click", fermerPanneau);

  /* ---------------- Survol et clic ---------------- */
  const ray = new THREE.Raycaster();
  const souris = new THREE.Vector2();
  let survol = null;
  const surbrillance = new THREE.Color(0x6a5cff);

  function cibles() {
    const liste = [];
    if (courant >= 0 && scenes[courant].p > 0.9 && !occupe) {
      for (const h of hotspots)
        if (h.chapitre === courant) {
          liste.push(h.sprite, ...h.meshes);
        }
    }
    return liste;
  }
  function viser(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    souris.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(souris, camera);
    const hit = ray.intersectObjects(cibles(), false)[0];
    if (hit) return { h: hit.object.userData.hotspot };
    // bords des pages : tourner la page / ouvrir le livre
    const pages = courant === -1 ? [couv.recto] : [pageL, pageR];
    const hp = ray.intersectObjects(pages, false)[0];
    if (hp) {
      if (courant === -1) return { nav: 0 };
      if (hp.object === pageR && hp.uv.x > 0.72 && courant < CHAPITRES.length - 1) return { nav: courant + 1 };
      if (hp.object === pageL && hp.uv.x < 0.28) return { nav: courant - 1 };
    }
    return null;
  }
  function eclairer(h, on) {
    if (!h) return;
    for (const m of h.meshes) {
      const mt = m.material;
      if (Array.isArray(mt) || !mt.emissive) continue;
      if (on) {
        mt.userData.e0 = mt.emissive.clone();
        mt.userData.i0 = mt.emissiveIntensity;
        mt.emissive.copy(surbrillance);
        mt.emissiveIntensity = 0.35;
      } else if (mt.userData.e0) {
        mt.emissive.copy(mt.userData.e0);
        mt.emissiveIntensity = mt.userData.i0;
        delete mt.userData.e0;
      }
    }
  }

  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const v = viser(e);
    const h = v && v.h ? v.h : null;
    if (h !== survol) {
      eclairer(survol, false);
      survol = h;
      // les animations réécrivent certains matériaux : on rallume à chaque image
    }
    renderer.domElement.style.cursor = v ? "pointer" : "grab";
    if (h) {
      tip.textContent = h.titre;
      tip.hidden = false;
      const r = stage.getBoundingClientRect();
      tip.style.transform = `translate(${e.clientX - r.left + 16}px, ${e.clientY - r.top + 14}px)`;
    } else if (v && v.nav !== undefined) {
      tip.textContent = courant === -1 ? "Ouvrir le livre" : v.nav > courant ? "Page suivante" : "Page précédente";
      tip.hidden = false;
      const r = stage.getBoundingClientRect();
      tip.style.transform = `translate(${e.clientX - r.left + 16}px, ${e.clientY - r.top + 14}px)`;
    } else tip.hidden = true;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    eclairer(survol, false);
    survol = null;
    tip.hidden = true;
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const v = viser(e);
    if (!v) return fermerPanneau();
    if (v.h) ouvrirPanneau(v.h);
    else allerA(v.nav);
  });

  /* ---------------- Taille et rendu ---------------- */
  function redimensionner() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const r = Math.min(2.6, Math.max(1, 1.75 / camera.aspect));
    if (Math.abs(r - recul) > 0.02) {
      recul = r;
      controls.maxDistance = 22 * recul;
      if (!occupe) {
        const v = ajuste(courant === -1 ? VUE_FERME : VUE_OUVERT);
        controls.target.copy(v.cible);
        camera.position.copy(v.cam);
      }
    }
  }
  new ResizeObserver(redimensionner).observe(stage);
  redimensionner();

  const horloge = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let visible = true;
  new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(stage);

  renderer.setAnimationLoop(() => {
    if (!visible && !tweens.length) return;
    const t = horloge.getElapsedTime();
    avancerTweens(performance.now());
    for (const S of scenes) if (S.groupe.visible) S.anim.forEach((fn) => fn(t));
    if (survol) {
      eclairer(survol, false);
      eclairer(survol, true);
    }
    // pastilles au-dessus des zones cliquables
    for (const h of hotspots) {
      const S = scenes[h.chapitre];
      const on = h.chapitre === courant && S.p > 0.95 && !occupe;
      h.sprite.visible = on;
      if (on) {
        h.ancre.getWorldPosition(tmp);
        h.sprite.position.set(tmp.x, tmp.y + h.haut, tmp.z);
        const k = h === survol || h === actif ? 1.25 : 1 + 0.12 * Math.sin(t * 4 + h.chapitre);
        h.sprite.scale.setScalar(0.3 * k);
      }
    }
    // la couverture « respire » pour inviter à l'ouvrir
    if (courant === -1 && !occupe) couv.poser(0.04 + 0.04 * Math.sin(t * 2), 1, PY + 0.012);
    controls.update();
    renderer.render(scene, camera);
  });

  root.classList.add("is-pret");
}
