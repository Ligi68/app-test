/*
 * Classement partagé pour les mini-jeux.
 * ---------------------------------------------------------------------------
 * Backend : Firebase Realtime Database, en REST (aucun SDK à charger).
 * Repli automatique en localStorage tant qu'aucune base n'est configurée
 * (ou si le réseau échoue) : le classement fonctionne alors « par appareil ».
 *
 *  >>> POUR ACTIVER LE CLASSEMENT PARTAGÉ (mondial) :
 *      1. Crée un projet sur https://console.firebase.google.com (gratuit)
 *      2. Menu « Realtime Database » → Créer une base → mode test
 *      3. Onglet « Règles » → mets :
 *           { "rules": { ".read": true, ".write": true } }
 *         (lecture/écriture publiques — suffisant pour un classement entre amis)
 *      4. Copie l'URL de la base (ex : https://xxxx-default-rtdb.firebaseio.com)
 *         et colle-la ci-dessous dans LB.config.dbUrl
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var LB = {};
  window.LB = LB;

  // <<<<<<<<<<<<<<<<  COLLE ICI L'URL DE TA BASE FIREBASE  >>>>>>>>>>>>>>>>
  LB.config = { dbUrl: "" };
  // Exemple : dbUrl: "https://mes-jeux-default-rtdb.europe-west1.firebasedatabase.app"

  var NAME_KEY = "lb.name";
  var localKey = function (g) { return "lb.local." + g; };

  // Métadonnées par jeu : sens du tri + unité affichée.
  //  dir "desc" = score élevé = meilleur (Snake, Bataille)
  //  dir "asc"  = score bas   = meilleur (Golf : moins de coups)
  var GAMES = {
    snake:    { label: "Snake",           dir: "desc", unit: "pts",   accent: "#34d399", icon: "🐍" },
    bataille: { label: "Bataille Navale", dir: "desc", unit: "pts",   accent: "#38bdf8", icon: "🚢" },
    golf:     { label: "Putting Golf",    dir: "asc",  unit: "coups", accent: "#4ade80", icon: "⛳" },
  };
  LB.games = GAMES;

  // ---------- Pseudo joueur ----------
  LB.getName = function () { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } };
  LB.setName = function (n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} };

  // ---------- Stockage local (cache + repli) ----------
  function loadLocal(g) { try { return JSON.parse(localStorage.getItem(localKey(g))) || []; } catch (e) { return []; } }
  function saveLocal(g, arr) { try { localStorage.setItem(localKey(g), JSON.stringify(arr)); } catch (e) {} }
  function sortArr(g, arr) {
    var dir = (GAMES[g] && GAMES[g].dir === "asc") ? 1 : -1;
    return arr.slice().sort(function (a, b) {
      return (a.score - b.score) * dir || (a.ts - b.ts);
    });
  }

  var isOnline = function () { return !!(LB.config.dbUrl && /^https?:\/\//.test(LB.config.dbUrl)); };
  LB.isShared = isOnline;
  function dbBase() { return LB.config.dbUrl.replace(/\/+$/, ""); }

  // ---------- Écriture d'un score ----------
  LB.submit = function (g, entry) {
    var rec = {
      name: String(entry.name || "Anonyme").slice(0, 16),
      score: entry.score,
      ts: Date.now(),
      meta: entry.meta || "",
    };
    // toujours en cache local (visible même hors-ligne)
    var arr = loadLocal(g); arr.push(rec); saveLocal(g, sortArr(g, arr).slice(0, 50));
    if (isOnline()) {
      return fetch(dbBase() + "/scores/" + g + ".json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec),
      }).catch(function () { /* hors-ligne : le cache local suffit */ });
    }
    return Promise.resolve();
  };

  // ---------- Lecture du top N ----------
  LB.top = function (g, n) {
    n = n || 10;
    if (isOnline()) {
      return fetch(dbBase() + "/scores/" + g + ".json")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          var arr = data ? Object.keys(data).map(function (k) { return data[k]; }) : [];
          return { source: "online", list: sortArr(g, arr).slice(0, n) };
        })
        .catch(function () {
          return { source: "local", list: sortArr(g, loadLocal(g)).slice(0, n) };
        });
    }
    return Promise.resolve({ source: "local", list: sortArr(g, loadLocal(g)).slice(0, n) });
  };

  // =========================================================================
  //  Interface (modales injectées, réutilisées par tous les jeux)
  // =========================================================================
  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return; styleInjected = true;
    var css = ''
      + '.lb-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;'
      + 'justify-content:center;padding:20px;background:rgba(6,15,26,.82);backdrop-filter:blur(4px);}'
      + '.lb-overlay.lb-hidden{display:none;}'
      + '.lb-card{background:var(--panel,#13293d);border:1px solid var(--line,var(--sea-line,#234a6b));'
      + 'border-radius:18px;padding:22px;width:100%;max-width:440px;box-shadow:0 16px 50px rgba(0,0,0,.55);'
      + 'color:var(--text,#e6f1ff);font-family:inherit;}'
      + '.lb-card h2{text-align:center;margin:0 0 4px;font-size:1.3rem;letter-spacing:1px;}'
      + '.lb-src{text-align:center;font-size:.72rem;color:var(--muted,#8ea9c1);margin-bottom:14px;}'
      + '.lb-src b{color:var(--good,#34d399);}'
      + '.lb-scoreline{text-align:center;font-size:1rem;margin:6px 0 14px;}'
      + '.lb-scoreline .v{font-weight:700;font-size:1.25rem;}'
      + '.lb-row{display:grid;grid-template-columns:30px 1fr auto;align-items:center;gap:10px;'
      + 'padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.03);margin-bottom:6px;font-size:.88rem;}'
      + '.lb-row.lb-me{outline:1px solid var(--accent,#38bdf8);background:rgba(56,189,248,.12);}'
      + '.lb-row.lb-top1{background:rgba(251,191,36,.14);}'
      + '.lb-row .lb-rank{text-align:center;font-weight:700;color:var(--muted,#8ea9c1);}'
      + '.lb-row.lb-top1 .lb-rank{color:#fbbf24;}'
      + '.lb-row .lb-nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.lb-row .lb-nm small{display:block;font-weight:400;color:var(--muted,#8ea9c1);font-size:.72rem;}'
      + '.lb-row .lb-sc{font-weight:700;}'
      + '.lb-empty{text-align:center;color:var(--muted,#8ea9c1);padding:18px;font-size:.85rem;}'
      + '.lb-input{width:100%;background:var(--bg,#0d1b2a);color:var(--text,#e6f1ff);'
      + 'border:1px solid var(--line,var(--sea-line,#234a6b));border-radius:10px;padding:11px 12px;'
      + 'font-size:.95rem;margin-bottom:14px;}'
      + '.lb-input:focus{outline:none;border-color:var(--accent,#38bdf8);}'
      + '.lb-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}'
      + '.lb-btn{background:var(--panel-2,#1b3a54);color:var(--text,#e6f1ff);'
      + 'border:1px solid var(--line,var(--sea-line,#234a6b));padding:11px 20px;border-radius:10px;'
      + 'font-size:.92rem;font-weight:600;cursor:pointer;font-family:inherit;}'
      + '.lb-btn:hover{filter:brightness(1.12);}'
      + '.lb-btn.lb-primary{border:none;color:#04263b;}';
    var s = document.createElement("style");
    s.textContent = css; document.head.appendChild(s);
  }

  var overlay = null, cardEl = null;
  function ensureOverlay() {
    injectStyle();
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "lb-overlay lb-hidden";
    cardEl = document.createElement("div");
    cardEl.className = "lb-card";
    overlay.appendChild(cardEl);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) hide(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay && !overlay.classList.contains("lb-hidden")) hide();
    });
    document.body.appendChild(overlay);
  }
  function show() { ensureOverlay(); overlay.classList.remove("lb-hidden"); }
  function hide() { if (overlay) overlay.classList.add("lb-hidden"); }
  LB.close = hide;

  function fmtScore(g, s) {
    var unit = (GAMES[g] && GAMES[g].unit) || "";
    return s + (unit ? " " + unit : "");
  }

  // ---------- Modale : proposer d'enregistrer un score ----------
  LB.promptSubmit = function (g, score, meta) {
    ensureOverlay();
    var meable = GAMES[g] || { label: g, accent: "#38bdf8", icon: "🏁" };
    cardEl.innerHTML = "";

    var h = document.createElement("h2");
    h.textContent = meable.icon + " " + meable.label;
    var sl = document.createElement("div");
    sl.className = "lb-scoreline";
    sl.innerHTML = 'Ton score : <span class="v">' + fmtScore(g, score) + "</span>" + (meta ? '<br><small style="color:var(--muted,#8ea9c1)">' + meta + "</small>" : "");
    var input = document.createElement("input");
    input.className = "lb-input"; input.maxLength = 16;
    input.placeholder = "Ton pseudo"; input.value = LB.getName();
    var btns = document.createElement("div"); btns.className = "lb-btns";
    var save = document.createElement("button");
    save.className = "lb-btn lb-primary"; save.textContent = "Enregistrer";
    save.style.background = "linear-gradient(135deg," + meable.accent + ",#22c55e)";
    var skip = document.createElement("button");
    skip.className = "lb-btn"; skip.textContent = "Plus tard";

    save.addEventListener("click", function () {
      var name = (input.value || "").trim() || "Anonyme";
      LB.setName(name);
      save.disabled = true; save.textContent = "…";
      Promise.resolve(LB.submit(g, { name: name, score: score, meta: meta || "" })).then(function () {
        LB.open(g);
      });
    });
    skip.addEventListener("click", hide);

    cardEl.appendChild(h); cardEl.appendChild(sl); cardEl.appendChild(input);
    cardEl.appendChild(btns); btns.appendChild(save); btns.appendChild(skip);
    show();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  };

  // ---------- Modale : afficher le classement ----------
  LB.open = function (g) {
    ensureOverlay();
    var meable = GAMES[g] || { label: g, icon: "🏆" };
    cardEl.innerHTML = "";
    var h = document.createElement("h2");
    h.textContent = "🏆 Classement — " + meable.label;
    var src = document.createElement("div"); src.className = "lb-src"; src.textContent = "Chargement…";
    var listEl = document.createElement("div");
    var btns = document.createElement("div"); btns.className = "lb-btns";
    var close = document.createElement("button");
    close.className = "lb-btn"; close.textContent = "Fermer";
    close.addEventListener("click", hide);
    btns.appendChild(close);
    cardEl.appendChild(h); cardEl.appendChild(src); cardEl.appendChild(listEl); cardEl.appendChild(btns);
    show();

    Promise.resolve(LB.top(g, 10)).then(function (res) {
      src.innerHTML = res.source === "online"
        ? 'Classement <b>partagé</b> · en ligne'
        : "Classement local (cet appareil)";
      var me = LB.getName();
      if (!res.list.length) {
        var e = document.createElement("div"); e.className = "lb-empty";
        e.textContent = "Aucun score pour l'instant. À toi d'ouvrir le bal !";
        listEl.appendChild(e); return;
      }
      res.list.forEach(function (it, i) {
        var row = document.createElement("div");
        row.className = "lb-row" + (i === 0 ? " lb-top1" : "") + (me && it.name === me ? " lb-me" : "");
        var rank = document.createElement("div"); rank.className = "lb-rank";
        rank.textContent = i === 0 ? "★" : (i + 1);
        var nm = document.createElement("div"); nm.className = "lb-nm";
        nm.textContent = it.name;
        if (it.meta) { var sm = document.createElement("small"); sm.textContent = it.meta; nm.appendChild(sm); }
        var sc = document.createElement("div"); sc.className = "lb-sc";
        sc.textContent = fmtScore(g, it.score);
        row.appendChild(rank); row.appendChild(nm); row.appendChild(sc);
        listEl.appendChild(row);
      });
    });
  };
})();
