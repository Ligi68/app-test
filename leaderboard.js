/*
 * Système de progression + classement mondial partagé pour les mini-jeux.
 * ---------------------------------------------------------------------------
 * Inspiré d'un profil type « Motus » : XP, niveaux, badges, classement global
 * et onglet « Aujourd'hui ». Un seul profil pour TOUS les jeux.
 *
 * Backend : Firebase Realtime Database en REST (aucun SDK).
 * Repli automatique en localStorage tant qu'aucune base n'est configurée
 * (ou si le réseau échoue) : la progression reste alors locale à l'appareil.
 *
 *  >>> POUR LE CLASSEMENT MONDIAL, renseigne LB.config.dbUrl ci-dessous, et
 *      règle les règles de la base sur :
 *        { "rules": { ".read": true, ".write": true } }
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var LB = {};
  window.LB = LB;

  // <<<<<<<<<<<<<<<<  URL DE LA BASE FIREBASE  >>>>>>>>>>>>>>>>
  LB.config = { dbUrl: "https://miniligigame-default-rtdb.europe-west1.firebasedatabase.app" };

  var PID_KEY = "lb.pid", NAME_KEY = "lb.name", PROF_KEY = "lb.profile.v2";

  // =========================================================================
  //  Identité joueur
  // =========================================================================
  function uuid() { return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
  LB.getPlayerId = function () {
    try { var id = localStorage.getItem(PID_KEY); if (!id) { id = uuid(); localStorage.setItem(PID_KEY, id); } return id; }
    catch (e) { return "p-anon"; }
  };
  LB.getName = function () { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } };
  LB.setName = function (n) {
    n = String(n || "").slice(0, 16);
    try { localStorage.setItem(NAME_KEY, n); } catch (e) {}
    var p = loadProfile(); p.name = n; saveProfile(p); pushProfile(p);
  };

  // =========================================================================
  //  Niveaux (courbe quadratique : niveau = floor(sqrt(xp/60)) + 1)
  // =========================================================================
  var K = 60;
  LB.levelFor = function (xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / K)) + 1; };
  function xpToReach(L) { return K * (L - 1) * (L - 1); }
  LB.levelInfo = function (xp) {
    var L = LB.levelFor(xp), cur = xpToReach(L), next = xpToReach(L + 1);
    return { level: L, into: xp - cur, span: next - cur, xp: xp };
  };

  // =========================================================================
  //  Profil (stocké localement, poussé en ligne)
  // =========================================================================
  function blankProfile() {
    return {
      id: LB.getPlayerId(), name: LB.getName() || "", xp: 0, emblem: "",
      plays: 0, wins: 0,
      games: { snake: { plays: 0, best: 0 }, bataille: { plays: 0, wins: 0, bestScore: 0 }, golf: { plays: 0, best: 0 } },
      flags: {}, badges: {}, created: Date.now(), updated: Date.now(),
    };
  }
  function loadProfile() {
    try {
      var p = JSON.parse(localStorage.getItem(PROF_KEY));
      if (p) {
        p.games = p.games || {}; p.flags = p.flags || {}; p.badges = p.badges || {};
        p.games.snake = p.games.snake || { plays: 0, best: 0 };
        p.games.bataille = p.games.bataille || { plays: 0, wins: 0, bestScore: 0 };
        p.games.golf = p.games.golf || { plays: 0, best: 0 };
        p.name = LB.getName() || p.name || "";
        return p;
      }
    } catch (e) {}
    return blankProfile();
  }
  function saveProfile(p) { p.updated = Date.now(); try { localStorage.setItem(PROF_KEY, JSON.stringify(p)); } catch (e) {} }
  LB.getProfile = loadProfile;

  var isOnline = function () { return !!(LB.config.dbUrl && /^https?:\/\//.test(LB.config.dbUrl)); };
  LB.isShared = isOnline;
  function db() { return LB.config.dbUrl.replace(/\/+$/, ""); }

  function pushProfile(p) {
    if (!isOnline()) return Promise.resolve();
    var pub = {
      name: p.name || "Anonyme", xp: p.xp, level: LB.levelFor(p.xp),
      emblem: p.emblem || "", plays: p.plays, wins: p.wins, updated: p.updated,
    };
    return fetch(db() + "/profiles/" + p.id + ".json", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pub),
    }).catch(function () {});
  }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function pushDaily(p, gained) {
    if (!isOnline() || gained <= 0) return Promise.resolve();
    var url = db() + "/daily/" + todayKey() + "/" + p.id + ".json";
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (cur) {
      cur = cur || { name: p.name || "Anonyme", xp: 0, plays: 0 };
      cur.name = p.name || "Anonyme"; cur.xp = (cur.xp || 0) + gained; cur.plays = (cur.plays || 0) + 1;
      return fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cur) });
    }).catch(function () {});
  }

  // =========================================================================
  //  Règles d'XP par jeu
  // =========================================================================
  var XP = {
    snake: function (d) { return Math.round((d.score || 0) * 1.2); },
    bataille: function (d) {
      if (d.win) {
        var base = { facile: 40, moyen: 70, difficile: 110 }[d.difficulty] || 50;
        var bonus = Math.max(0, Math.round((30 - (d.shots || 30)) * 3));
        return base + bonus;
      }
      return 12; // participation
    },
    golf: function (d) { return Math.max(20, Math.round(240 - (d.strokes || 36) * 4)); },
  };
  function isWin(game, d) { return game === "bataille" ? !!d.win : (game === "golf"); }

  // =========================================================================
  //  Badges
  // =========================================================================
  var BADGES = [
    { cat: "Débuts", id: "premier_pas", name: "Premier pas", icon: "🎯", desc: "Jouer une partie", test: function (p) { return p.plays >= 1; }, goal: function (p) { return [p.plays, 1]; } },
    { cat: "Débuts", id: "premiere_victoire", name: "Première victoire", icon: "🏆", desc: "Gagner une partie", test: function (p) { return p.wins >= 1; }, goal: function (p) { return [p.wins, 1]; } },
    { cat: "Débuts", id: "touche_a_tout", name: "Touche-à-tout", icon: "🧭", desc: "Jouer aux 3 jeux", test: function (p) { return p.games.snake.plays > 0 && p.games.bataille.plays > 0 && p.games.golf.plays > 0; }, goal: function (p) { return [(p.games.snake.plays > 0) + (p.games.bataille.plays > 0) + (p.games.golf.plays > 0), 3]; } },
    { cat: "Volume", id: "habitue", name: "Habitué", icon: "🎖️", desc: "10 parties jouées", test: function (p) { return p.plays >= 10; }, goal: function (p) { return [p.plays, 10]; } },
    { cat: "Volume", id: "pilier", name: "Pilier", icon: "🏛️", desc: "50 parties jouées", test: function (p) { return p.plays >= 50; }, goal: function (p) { return [p.plays, 50]; } },
    { cat: "Volume", id: "centurion", name: "Centurion", icon: "💯", desc: "100 parties jouées", test: function (p) { return p.plays >= 100; }, goal: function (p) { return [p.plays, 100]; } },
    { cat: "Niveau", id: "etoile", name: "Étoile montante", icon: "⭐", desc: "Atteindre le niveau 5", test: function (p) { return LB.levelFor(p.xp) >= 5; }, goal: function (p) { return [LB.levelFor(p.xp), 5]; } },
    { cat: "Niveau", id: "diamant", name: "Diamant", icon: "💎", desc: "Atteindre le niveau 10", test: function (p) { return LB.levelFor(p.xp) >= 10; }, goal: function (p) { return [LB.levelFor(p.xp), 10]; } },
    { cat: "Niveau", id: "supernova", name: "Supernova", icon: "🌟", desc: "Atteindre le niveau 20", test: function (p) { return LB.levelFor(p.xp) >= 20; }, goal: function (p) { return [LB.levelFor(p.xp), 20]; } },
    { cat: "Snake", id: "gourmand", name: "Gourmand", icon: "🍎", desc: "Score de 30 à Snake", test: function (p) { return p.games.snake.best >= 30; }, goal: function (p) { return [p.games.snake.best, 30]; } },
    { cat: "Snake", id: "vorace", name: "Vorace", icon: "🐍", desc: "Score de 60 à Snake", test: function (p) { return p.games.snake.best >= 60; }, goal: function (p) { return [p.games.snake.best, 60]; } },
    { cat: "Bataille", id: "amiral", name: "Amiral", icon: "⚓", desc: "Gagner en difficulté Difficile", test: function (p) { return !!p.flags.bataille_difficile; } },
    { cat: "Bataille", id: "redoutable", name: "Redoutable", icon: "🎯", desc: "Gagner en moins de 25 coups", test: function (p) { return !!p.flags.bataille_rapide; } },
    { cat: "Golf", id: "sous_le_par", name: "Sous le par", icon: "⛳", desc: "Parcours en moins de 27 coups", test: function (p) { return p.games.golf.best > 0 && p.games.golf.best < 27; } },
    { cat: "Golf", id: "trou_en_un", name: "Trou en un", icon: "🕳️", desc: "Rentrer un trou en 1 coup", test: function (p) { return !!p.flags.golf_hio; } },
  ];
  LB.badges = BADGES;
  function recomputeBadges(p) {
    var newly = [];
    BADGES.forEach(function (b) { if (!p.badges[b.id] && b.test(p)) { p.badges[b.id] = Date.now(); newly.push(b); } });
    return newly;
  }

  // =========================================================================
  //  Enregistrement d'une partie terminée
  // =========================================================================
  LB.record = function (game, data) {
    data = data || {};
    var p = loadProfile();
    p.name = LB.getName() || p.name;
    var gained = Math.max(0, XP[game] ? XP[game](data) : 0);
    p.xp += gained; p.plays++;
    var g = p.games[game] || (p.games[game] = { plays: 0 }); g.plays++;
    if (isWin(game, data)) p.wins++;

    if (game === "snake") { g.best = Math.max(g.best || 0, data.score || 0); }
    if (game === "bataille") {
      if (data.win) {
        g.wins = (g.wins || 0) + 1;
        if (data.difficulty === "difficile") p.flags.bataille_difficile = true;
        if ((data.shots || 99) < 25) p.flags.bataille_rapide = true;
        g.bestScore = Math.max(g.bestScore || 0, data.score || 0);
      }
    }
    if (game === "golf") {
      if (data.strokes) g.best = g.best ? Math.min(g.best, data.strokes) : data.strokes;
      if (data.holeInOne) p.flags.golf_hio = true;
    }

    var newly = recomputeBadges(p);
    var bonus = newly.length * 25;
    p.xp += bonus;
    saveProfile(p);
    pushProfile(p); pushDaily(p, gained + bonus);

    var res = { gained: gained, bonus: bonus, badges: newly, level: LB.levelFor(p.xp), xp: p.xp };
    toastXP(res);
    if (p.plays === 1 && !LB.getName()) setTimeout(function () { LB.openProfile("profil"); }, 900);
    return res;
  };

  // =========================================================================
  //  Lectures en ligne
  // =========================================================================
  LB.ranking = function (n) {
    n = n || 20;
    var mine = loadProfile();
    if (isOnline()) {
      return fetch(db() + "/profiles.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        var arr = [];
        if (data) Object.keys(data).forEach(function (k) { var v = data[k]; v.id = k; arr.push(v); });
        arr.sort(function (a, b) { return (b.xp || 0) - (a.xp || 0); });
        var rank = arr.findIndex(function (v) { return v.id === mine.id; }) + 1;
        return { source: "online", list: arr.slice(0, n), total: arr.length, rank: rank, meId: mine.id };
      }).catch(function () {
        return { source: "local", list: [localPub(mine)], total: 1, rank: 1, meId: mine.id };
      });
    }
    return Promise.resolve({ source: "local", list: [localPub(mine)], total: 1, rank: 1, meId: mine.id });
  };
  function localPub(p) { return { id: p.id, name: p.name || "Anonyme", xp: p.xp, level: LB.levelFor(p.xp), emblem: p.emblem || "" }; }

  LB.daily = function (n) {
    n = n || 10;
    if (isOnline()) {
      return fetch(db() + "/daily/" + todayKey() + ".json").then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        var arr = [], plays = 0;
        if (data) Object.keys(data).forEach(function (k) { var v = data[k]; v.id = k; plays += v.plays || 0; arr.push(v); });
        arr.sort(function (a, b) { return (b.xp || 0) - (a.xp || 0); });
        return { source: "online", list: arr.slice(0, n), plays: plays };
      }).catch(function () { return { source: "local", list: [], plays: 0 }; });
    }
    return Promise.resolve({ source: "local", list: [], plays: 0 });
  };

  // =========================================================================
  //  Emblème (badge mis en avant à côté du nom)
  // =========================================================================
  LB.setEmblem = function (icon) { var p = loadProfile(); p.emblem = icon || ""; saveProfile(p); pushProfile(p); };

  // =========================================================================
  //  XP toast
  // =========================================================================
  var toastEl = null;
  function toastXP(res) {
    if (typeof document === "undefined") return;
    if (!toastEl) {
      injectStyle();
      toastEl = document.createElement("div"); toastEl.className = "lb-toast";
      document.body.appendChild(toastEl);
    }
    var txt = "+" + res.gained + " XP";
    if (res.bonus) txt += " (+" + res.bonus + " badge)";
    var extra = res.badges.length ? '<div class="lb-toast-b">' + res.badges.map(function (b) { return b.icon + " " + b.name; }).join(" · ") + "</div>" : "";
    toastEl.innerHTML = '<div class="lb-toast-x">' + txt + "</div>" + extra;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  // =========================================================================
  //  Interface : la modale profil (4 onglets)
  // =========================================================================
  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return; styleInjected = true;
    var css = ''
      + '.lb-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(6,15,26,.82);backdrop-filter:blur(4px);}'
      + '.lb-overlay.lb-hidden{display:none;}'
      + '.lb-card{background:var(--panel,#13293d);border:1px solid var(--line,var(--sea-line,#234a6b));border-radius:18px;padding:18px;width:100%;max-width:460px;max-height:90vh;overflow:auto;box-shadow:0 16px 50px rgba(0,0,0,.55);color:var(--text,#e6f1ff);font-family:inherit;}'
      + '.lb-tabs{display:flex;gap:6px;margin-bottom:14px;}'
      + '.lb-tab{flex:1;text-align:center;padding:9px 4px;border-radius:10px;background:var(--panel-2,#1b3a54);color:var(--muted,#8ea9c1);border:1px solid var(--line,#234a6b);font-weight:600;font-size:.82rem;cursor:pointer;}'
      + '.lb-tab.on{background:linear-gradient(135deg,var(--accent,#38bdf8),#0ea5e9);color:#04263b;border:none;}'
      + '.lb-h{text-align:center;font-size:1.05rem;font-weight:700;margin:4px 0 10px;}'
      + '.lb-src{text-align:center;font-size:.72rem;color:var(--muted,#8ea9c1);margin-bottom:12px;}'
      + '.lb-src b{color:var(--good,#34d399);}'
      + '.lb-namerow{display:flex;gap:8px;margin-bottom:14px;}'
      + '.lb-input{flex:1;background:var(--bg,#0d1b2a);color:var(--text,#e6f1ff);border:1px solid var(--line,#234a6b);border-radius:10px;padding:11px 12px;font-size:.95rem;}'
      + '.lb-input:focus{outline:none;border-color:var(--accent,#38bdf8);}'
      + '.lb-btn{background:var(--panel-2,#1b3a54);color:var(--text,#e6f1ff);border:1px solid var(--line,#234a6b);padding:10px 18px;border-radius:10px;font-size:.9rem;font-weight:600;cursor:pointer;font-family:inherit;}'
      + '.lb-btn:hover{filter:brightness(1.12);}'
      + '.lb-btn.p{border:none;color:#04263b;background:linear-gradient(135deg,var(--accent,#38bdf8),#0ea5e9);}'
      + '.lb-lvl{display:flex;align-items:center;gap:12px;margin-bottom:6px;}'
      + '.lb-lvlbadge{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:800;background:linear-gradient(135deg,var(--accent,#38bdf8),#0ea5e9);color:#04263b;flex:none;}'
      + '.lb-lvltext{flex:1;}'
      + '.lb-lvltext .n{font-weight:700;}'
      + '.lb-bar{height:12px;border-radius:7px;background:var(--bg,#0d1b2a);border:1px solid var(--line,#234a6b);overflow:hidden;margin-top:5px;}'
      + '.lb-bar>span{display:block;height:100%;background:linear-gradient(90deg,#fbbf24,var(--accent,#38bdf8));}'
      + '.lb-xpsmall{font-size:.72rem;color:var(--muted,#8ea9c1);margin-top:3px;}'
      + '.lb-stats{display:flex;gap:8px;margin:14px 0;}'
      + '.lb-stat{flex:1;text-align:center;background:rgba(255,255,255,.03);border-radius:10px;padding:8px;}'
      + '.lb-stat .v{font-size:1.2rem;font-weight:700;color:var(--accent,#38bdf8);}'
      + '.lb-stat .l{font-size:.64rem;color:var(--muted,#8ea9c1);text-transform:uppercase;letter-spacing:.5px;}'
      + '.lb-sec{font-size:.72rem;color:var(--muted,#8ea9c1);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px;display:flex;justify-content:space-between;}'
      + '.lb-obj{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:10px;background:rgba(255,255,255,.03);margin-bottom:6px;}'
      + '.lb-obj .ic{font-size:1.2rem;}'
      + '.lb-obj .nm{flex:1;font-size:.85rem;}'
      + '.lb-obj .nm small{display:block;color:var(--muted,#8ea9c1);font-size:.72rem;}'
      + '.lb-obj .pg{font-size:.8rem;color:var(--muted,#8ea9c1);font-weight:700;}'
      + '.lb-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;}'
      + '.lb-badge{text-align:center;opacity:.35;cursor:pointer;}'
      + '.lb-badge.got{opacity:1;}'
      + '.lb-badge.sel{outline:2px solid var(--gold,#fbbf24);border-radius:12px;}'
      + '.lb-badge .b{width:46px;height:46px;margin:0 auto 3px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:1.4rem;}'
      + '.lb-badge .t{font-size:.6rem;color:var(--muted,#8ea9c1);line-height:1.1;}'
      + '.lb-row{display:grid;grid-template-columns:30px 1fr auto;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.03);margin-bottom:6px;font-size:.88rem;}'
      + '.lb-row.me{outline:1px solid var(--accent,#38bdf8);background:rgba(56,189,248,.12);}'
      + '.lb-row.top1{background:rgba(251,191,36,.14);}'
      + '.lb-row .rk{text-align:center;font-weight:700;color:var(--muted,#8ea9c1);}'
      + '.lb-row.top1 .rk{color:#fbbf24;}'
      + '.lb-row .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.lb-row .sc{color:var(--muted,#8ea9c1);font-size:.8rem;text-align:right;}'
      + '.lb-place{text-align:center;margin-bottom:12px;font-size:1rem;}'
      + '.lb-place b{color:var(--accent,#38bdf8);font-size:1.5rem;}'
      + '.lb-empty{text-align:center;color:var(--muted,#8ea9c1);padding:16px;font-size:.85rem;}'
      + '.lb-desc{text-align:center;font-size:.8rem;color:var(--muted,#8ea9c1);min-height:1.1em;margin-bottom:8px;}'
      + '.lb-toast{position:fixed;left:50%;bottom:74px;transform:translateX(-50%) translateY(20px);z-index:1200;background:rgba(6,15,26,.92);border:1px solid var(--good,#34d399);border-radius:14px;padding:10px 18px;text-align:center;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;}'
      + '.lb-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}'
      + '.lb-toast-x{font-weight:800;color:var(--good,#34d399);}'
      + '.lb-toast-b{font-size:.75rem;color:var(--gold,#fbbf24);margin-top:2px;}';
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  var overlay = null, cardEl = null, curTab = "profil";
  function ensureOverlay() {
    injectStyle();
    if (overlay) return;
    overlay = document.createElement("div"); overlay.className = "lb-overlay lb-hidden";
    cardEl = document.createElement("div"); cardEl.className = "lb-card";
    overlay.appendChild(cardEl);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) hide(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && overlay && !overlay.classList.contains("lb-hidden")) hide(); });
    document.body.appendChild(overlay);
  }
  function show() { ensureOverlay(); overlay.classList.remove("lb-hidden"); }
  function hide() { if (overlay) overlay.classList.add("lb-hidden"); }
  LB.close = hide;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  LB.openProfile = function (tab) {
    ensureOverlay();
    curTab = tab || curTab || "profil";
    render();
    show();
  };
  // Alias rétro-compat
  LB.open = function () { LB.openProfile("classement"); };

  function render() {
    cardEl.innerHTML = "";
    var tabs = el("div", "lb-tabs");
    [["profil", "Profil"], ["badges", "Badges"], ["classement", "Classement"], ["auj", "Auj."]].forEach(function (t) {
      var b = el("div", "lb-tab" + (curTab === t[0] ? " on" : ""), t[1]);
      b.addEventListener("click", function () { curTab = t[0]; render(); });
      tabs.appendChild(b);
    });
    cardEl.appendChild(tabs);
    var body = el("div");
    cardEl.appendChild(body);
    if (curTab === "profil") renderProfil(body);
    else if (curTab === "badges") renderBadges(body);
    else if (curTab === "classement") renderRanking(body);
    else renderDaily(body);
    var foot = el("div", null, "");
    foot.style.cssText = "display:flex;justify-content:center;margin-top:14px;";
    var close = el("button", "lb-btn", "Fermer"); close.addEventListener("click", hide);
    foot.appendChild(close); cardEl.appendChild(foot);
  }

  function renderProfil(body) {
    var p = loadProfile();
    var info = LB.levelInfo(p.xp);
    // pseudo
    var row = el("div", "lb-namerow");
    var input = el("input", "lb-input"); input.maxLength = 16; input.placeholder = "Ton pseudo"; input.value = p.name || "";
    var ok = el("button", "lb-btn p", "OK");
    ok.addEventListener("click", function () { LB.setName((input.value || "").trim()); render(); });
    row.appendChild(input); row.appendChild(ok); body.appendChild(row);
    // emblème + niveau
    var lvl = el("div", "lb-lvl");
    lvl.appendChild(el("div", "lb-lvlbadge", p.emblem || String(info.level)));
    var lt = el("div", "lb-lvltext");
    lt.appendChild(el("div", "n", "Niveau " + info.level + (info.level === 1 ? " · Débutant" : "")));
    var bar = el("div", "lb-bar"); var span = el("span"); span.style.width = Math.round(info.span ? info.into / info.span * 100 : 0) + "%"; bar.appendChild(span);
    lt.appendChild(bar);
    lt.appendChild(el("div", "lb-xpsmall", info.into + " / " + info.span + " XP (encore " + Math.max(0, info.span - info.into) + ")"));
    lvl.appendChild(lt); body.appendChild(lvl);
    // stats
    var st = el("div", "lb-stats");
    st.appendChild(stat(p.plays, "Parties")); st.appendChild(stat(p.wins, "Victoires")); st.appendChild(stat(p.xp, "XP total"));
    body.appendChild(st);
    // prochains objectifs
    body.appendChild(el("div", "lb-sec", "<span>Prochains objectifs</span>"));
    var locked = BADGES.filter(function (b) { return !p.badges[b.id] && b.goal; });
    locked.forEach(function (b) { var g = b.goal(p); b._r = g[1] ? g[0] / g[1] : 0; });
    locked.sort(function (a, b) { return b._r - a._r; });
    locked.slice(0, 3).forEach(function (b) {
      var g = b.goal(p);
      var o = el("div", "lb-obj");
      o.appendChild(el("div", "ic", b.icon));
      o.appendChild(el("div", "nm", b.name + "<small>" + b.desc + "</small>"));
      o.appendChild(el("div", "pg", Math.min(g[0], g[1]) + "/" + g[1]));
      body.appendChild(o);
    });
    if (!locked.length) body.appendChild(el("div", "lb-empty", "Tous les objectifs chiffrés sont atteints ! 🎉"));
    // résumé par jeu
    body.appendChild(el("div", "lb-sec", "<span>Par jeu</span>"));
    body.appendChild(el("div", "lb-xpsmall", "🐍 Snake — " + p.games.snake.plays + " parties · record " + p.games.snake.best));
    body.appendChild(el("div", "lb-xpsmall", "🚢 Bataille — " + p.games.bataille.plays + " parties · " + (p.games.bataille.wins || 0) + " victoires"));
    body.appendChild(el("div", "lb-xpsmall", "⛳ Golf — " + p.games.golf.plays + " parcours · record " + (p.games.golf.best || "—") + " coups"));
  }
  function stat(v, l) { var s = el("div", "lb-stat"); s.appendChild(el("div", "v", v)); s.appendChild(el("div", "l", l)); return s; }

  function renderBadges(body) {
    var p = loadProfile();
    var got = Object.keys(p.badges).length;
    body.appendChild(el("div", "lb-h", got + " / " + BADGES.length + " badges"));
    var desc = el("div", "lb-desc", "Touche un badge débloqué pour en faire ton emblème");
    body.appendChild(desc);
    var cats = {};
    BADGES.forEach(function (b) { (cats[b.cat] = cats[b.cat] || []).push(b); });
    Object.keys(cats).forEach(function (cat) {
      var list = cats[cat];
      var gotN = list.filter(function (b) { return p.badges[b.id]; }).length;
      body.appendChild(el("div", "lb-sec", "<span>" + cat + "</span><span>" + gotN + "/" + list.length + "</span>"));
      var grid = el("div", "lb-grid");
      list.forEach(function (b) {
        var has = !!p.badges[b.id];
        var cell = el("div", "lb-badge" + (has ? " got" : "") + (p.emblem === b.icon ? " sel" : ""));
        cell.appendChild(el("div", "b", b.icon));
        cell.appendChild(el("div", "t", b.name));
        cell.addEventListener("click", function () {
          desc.textContent = b.icon + " " + b.name + " — " + b.desc + (has ? "" : " (verrouillé)");
          if (has) { LB.setEmblem(p.emblem === b.icon ? "" : b.icon); render(); }
        });
        grid.appendChild(cell);
      });
      body.appendChild(grid);
    });
  }

  function renderRanking(body) {
    var place = el("div", "lb-place", "Chargement…");
    var src = el("div", "lb-src", "");
    var refresh = el("button", "lb-btn", "↻ Actualiser");
    refresh.style.cssText = "display:block;width:100%;margin-bottom:12px;";
    var list = el("div");
    refresh.addEventListener("click", function () { fill(); });
    body.appendChild(place); body.appendChild(src); body.appendChild(refresh); body.appendChild(list);
    function fill() {
      place.textContent = "Chargement…"; list.innerHTML = "";
      LB.ranking(20).then(function (res) {
        src.innerHTML = res.source === "online" ? "Classement <b>mondial</b> · par XP" : "Classement local (branche Firebase pour le partage)";
        place.innerHTML = res.rank ? ('Ta place : <b>#' + res.rank + "</b> sur " + res.total + " joueurs") : ("sur " + res.total + " joueurs");
        if (!res.list.length) { list.appendChild(el("div", "lb-empty", "Aucun joueur pour l'instant.")); return; }
        res.list.forEach(function (v, i) {
          var row = el("div", "lb-row" + (i === 0 ? " top1" : "") + (v.id === res.meId ? " me" : ""));
          row.appendChild(el("div", "rk", i === 0 ? "★" : (i + 1)));
          row.appendChild(el("div", "nm", (v.emblem ? v.emblem + " " : "") + (v.name || "Anonyme")));
          row.appendChild(el("div", "sc", "Niv. " + (v.level || LB.levelFor(v.xp || 0)) + " · " + (v.xp || 0) + " XP"));
          list.appendChild(row);
        });
      });
    }
    fill();
  }

  function renderDaily(body) {
    var src = el("div", "lb-src", "Chargement…");
    var head = el("div", "lb-place", "");
    var list = el("div");
    body.appendChild(head); body.appendChild(src); body.appendChild(el("div", "lb-sec", "<span>Top du jour</span>")); body.appendChild(list);
    LB.daily(10).then(function (res) {
      src.innerHTML = res.source === "online" ? "Activité de la <b>communauté</b> aujourd'hui" : "Branche Firebase pour le suivi communautaire";
      head.innerHTML = "<b>" + res.plays + "</b> parties jouées aujourd'hui";
      if (!res.list.length) { list.appendChild(el("div", "lb-empty", "Personne n'a encore joué aujourd'hui.")); return; }
      res.list.forEach(function (v, i) {
        var row = el("div", "lb-row" + (i === 0 ? " top1" : ""));
        row.appendChild(el("div", "rk", i === 0 ? "★" : (i + 1)));
        row.appendChild(el("div", "nm", v.name || "Anonyme"));
        row.appendChild(el("div", "sc", (v.xp || 0) + " XP · " + (v.plays || 0) + " parties"));
        list.appendChild(row);
      });
    });
  }
})();
