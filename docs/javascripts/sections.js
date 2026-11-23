/*
 * Parties repliables pour les pages de TP.
 *
 * Sur chaque page d'un TP (docs/units/<ue>/tp/<tp>/), chaque titre de niveau 2
 * (« ## Partie ... ») devient un bandeau cliquable : au chargement on ne voit que
 * les titres des parties, un clic déroule la partie avec une animation douce.
 * Rien à changer dans les fichiers Markdown.
 *
 * - Les liens vers une ancre (table des matières, liens internes, URL avec #...)
 *   ouvrent automatiquement la partie concernée.
 * - La recherche du navigateur (Ctrl+F) trouve aussi le texte des parties fermées
 *   et les ouvre (navigateurs récents, grâce à hidden="until-found").
 * - Les boutons « Tout ouvrir / Tout fermer » sont placés avant la première partie.
 * - À l'impression, tout est affiché.
 */
(function () {
  "use strict";

  // Pages concernées : /units/<ue>/tp/<tp>/ et /units/<ue>/projet/<projet>/ (pas les listes)
  var PAGE = /\/units\/[^/]+\/(tp|projet)\/[^/]+\/?(index\.html)?$/;
  var DURATION = 350; // ms, garder en phase avec sections.css

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setHidden(body) {
    // "until-found" : caché mais trouvable par Ctrl+F ; sinon simple hidden
    if ("onbeforematch" in document.body) body.setAttribute("hidden", "until-found");
    else body.hidden = true;
  }

  function finish(sec) {
    var body = sec.body;
    body.style.height = "";
    body.style.overflow = "";
    if (!sec.open) setHidden(body);
    sec.timer = null;
  }

  function setOpen(sec, open, animate) {
    if (sec.open === open) return;
    sec.open = open;
    var body = sec.body;
    sec.el.classList.toggle("tps--open", open);
    sec.head.setAttribute("aria-expanded", open ? "true" : "false");
    if (sec.timer) { clearTimeout(sec.timer); sec.timer = null; }

    if (!animate || reduceMotion) {
      body.style.height = "";
      body.style.overflow = "";
      if (open) body.removeAttribute("hidden"); else setHidden(body);
      return;
    }

    body.style.overflow = "hidden";
    if (open) {
      body.removeAttribute("hidden");
      var from = body.style.height || "0px";
      body.style.height = from;
      var to = body.scrollHeight + "px";
      body.offsetHeight; // force le recalcul pour lancer la transition
      body.style.height = to;
    } else {
      body.style.height = body.scrollHeight + "px";
      body.offsetHeight;
      body.style.height = "0px";
    }
    sec.timer = setTimeout(function () { finish(sec); }, DURATION + 30);
  }

  function init() {
    if (!PAGE.test(location.pathname)) return;
    var article = document.querySelector(".md-content article");
    if (!article || article.dataset.tpsReady) return;
    var heads = Array.prototype.filter.call(article.children, function (n) {
      return n.tagName === "H2";
    });
    if (heads.length < 2) return;
    article.dataset.tpsReady = "1";
    article.classList.add("tps-page");

    var sections = heads.map(function (h2, i) {
      var el = document.createElement("section");
      el.className = "tps";
      var body = document.createElement("div");
      body.className = "tps-body";
      body.id = "tps-body-" + i;
      var inner = document.createElement("div");
      inner.className = "tps-inner";
      body.appendChild(inner);

      h2.parentNode.insertBefore(el, h2);
      el.appendChild(h2);
      el.appendChild(body);
      // déplace tout ce qui suit jusqu'au prochain h2
      var next = el.nextSibling;
      while (next && next.tagName !== "H2") {
        var after = next.nextSibling;
        inner.appendChild(next);
        next = after;
      }

      h2.classList.add("tps-head");
      h2.setAttribute("role", "button");
      h2.setAttribute("tabindex", "0");
      h2.setAttribute("aria-controls", body.id);
      h2.setAttribute("aria-expanded", "false");
      var chev = document.createElement("span");
      chev.className = "tps-chevron";
      chev.setAttribute("aria-hidden", "true");
      h2.insertBefore(chev, h2.firstChild);

      var sec = { el: el, head: h2, body: body, open: true, timer: null };
      setOpen(sec, false, false);

      h2.addEventListener("click", function (e) {
        if (e.target.closest("a")) return; // le ¶ garde son rôle de lien
        setOpen(sec, !sec.open, true);
      });
      h2.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen(sec, !sec.open, true);
        }
      });
      body.addEventListener("beforematch", function () { setOpen(sec, true, false); });
      return sec;
    });

    // Barre « Tout ouvrir / Tout fermer »
    var bar = document.createElement("div");
    bar.className = "tps-bar";
    bar.innerHTML =
      '<span class="tps-bar__hint">Cliquez sur une partie pour l’afficher.</span>' +
      '<button type="button" class="md-button tps-bar__btn" data-tps="open">Tout ouvrir</button>' +
      '<button type="button" class="md-button tps-bar__btn" data-tps="close">Tout fermer</button>';
    sections[0].el.parentNode.insertBefore(bar, sections[0].el);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var open = b.dataset.tps === "open";
      sections.forEach(function (s) { setOpen(s, open, true); });
    });

    function sectionOf(node) {
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].el.contains(node)) return sections[i];
      }
      return null;
    }

    // Ouvre la partie qui contient l'ancre visée (#...)
    function reveal(hash, scroll) {
      if (!hash || hash.length < 2) return;
      var target;
      try { target = document.getElementById(decodeURIComponent(hash.slice(1))); }
      catch (err) { return; }
      if (!target) return;
      var sec = sectionOf(target);
      if (sec && target !== sec.head) setOpen(sec, true, false);
      else if (sec) setOpen(sec, true, true);
      if (scroll) target.scrollIntoView();
    }

    // Liens internes (table des matières, renvois) : on ouvre avant que le
    // navigateur ne fasse défiler la page.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href*="#"]');
      if (!a || a.origin !== location.origin || a.pathname !== location.pathname) return;
      reveal(a.hash, false);
    }, true);
    window.addEventListener("hashchange", function () { reveal(location.hash, true); });

    // Arrivée depuis la recherche du site (?h=...) : tout ouvrir
    if (/[?&]h=/.test(location.search)) {
      sections.forEach(function (s) { setOpen(s, true, false); });
    }
    if (location.hash) reveal(location.hash, true);

    // Impression : tout afficher
    window.addEventListener("beforeprint", function () {
      sections.forEach(function (s) { s.wasOpen = s.open; setOpen(s, true, false); });
    });
    window.addEventListener("afterprint", function () {
      sections.forEach(function (s) { setOpen(s, s.wasOpen, false); });
    });
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(init); // compatible avec navigation.instant
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
