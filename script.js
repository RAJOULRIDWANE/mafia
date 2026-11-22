(function () {
  'use strict';

  /* ============ Data ============ */
  const MIN_PLAYERS = 3;

  const ROLES = [
    { id: 'mafia', name: 'Mafia', min: 1,
      short: 'Eliminates one player each night.',
      desc: 'You are part of the Mafia. Each night, you and your team agree on one player to eliminate. Stay hidden during the day.' },
    { id: 'doctor', name: 'Doctor', min: 0,
      short: 'Saves one player each night.',
      desc: 'Each night, you choose one player to protect. If the Mafia targets them, they survive.' },
    { id: 'detective', name: 'Detective', min: 0,
      short: 'Checks if a player is Mafia.',
      desc: 'Each night, you point at one player and the narrator tells you whether they are Mafia.' },
    { id: 'cupid', name: 'Cupid', min: 0,
      short: 'Links two lovers on the first night.',
      desc: 'On the first night, you choose two players to become lovers. If one of them dies, the other dies too.' },
    { id: 'heir', name: 'The Heir', min: 0,
      short: 'Inherits a role when its owner dies.',
      desc: 'When the player you are tied to dies, you inherit their role. Your narrator will explain how it works in your game.' }
  ];
  const CITIZEN = { id: 'citizen', name: 'Citizen',
    desc: 'You have no special power. Watch, discuss, and vote to find the Mafia.' };

  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const ICONS = window.ICONS || {};
  function iconSvg(id) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (ICONS[id] || '') + '</svg>';
  }
  function makeBadge(id, extra) {
    const b = document.createElement('span');
    b.className = 'badge' + (extra ? ' ' + extra : '');
    b.dataset.role = id;
    b.innerHTML = iconSvg(id);
    return b;
  }

  /* ============ State (memory only) ============ */
  const state = {
    total: 6,
    counts: { mafia: 1, doctor: 0, detective: 0, cupid: 0, heir: 0 },
    names: ['', '', '', '', '', ''],
    assignments: [],      // [{ name, role, seen }]
    index: 0,
    tried: false          // user attempted to start with problems
  };

  /* ============ Helpers ============ */
  const $ = (id) => document.getElementById(id);
  const roleById = (id) => (id === 'citizen' ? CITIZEN : ROLES.find((r) => r.id === id));
  const assignedCount = () => ROLES.reduce((s, r) => s + state.counts[r.id], 0);

  // Uniform random integer in [0, max) using the browser's cryptographic RNG.
  // Rejection sampling removes modulo bias, so every value is equally likely.
  function randInt(max) {
    const c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues && max > 0) {
      const range = 0x100000000;
      const limit = range - (range % max);
      const buf = new Uint32Array(1);
      let x;
      do { c.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return x % max;
    }
    return Math.floor(Math.random() * max);
  }

  // One Fisher-Yates pass (unbiased)
  function fisherYates(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Several independent passes, each followed by a random cut of the deck.
  // The number of passes is itself random (6 to 11), so the process is not predictable.
  function shuffle(arr) {
    let a = arr.slice();
    const passes = 6 + randInt(6);
    for (let p = 0; p < passes; p++) {
      fisherYates(a);
      const cut = randInt(a.length);
      a = a.slice(cut).concat(a.slice(0, cut));
    }
    return a;
  }

  function setMessages(el, items) {
    el.textContent = '';
    items.forEach((it) => {
      const p = document.createElement('p');
      p.className = 'msg ' + it.type;
      p.textContent = it.text;
      el.appendChild(p);
    });
  }

  const SCREENS = ['screen-setup', 'screen-pass', 'screen-reveal', 'screen-end'];
  function showScreen(id) {
    SCREENS.forEach((s) => { $(s).hidden = s !== id; });
    $('add-player-btn').hidden = !(id === 'screen-pass' || id === 'screen-reveal');
    window.scrollTo(0, 0);
  }

  let toastTimer = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  /* ============ Theme ============ */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const btn = $('theme-toggle');
    btn.innerHTML = t === 'dark' ? ICON_SUN : ICON_MOON;
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0d1117' : '#f4f6f9');
    try { localStorage.setItem('mafia-theme', t); } catch (e) {}
  }
  $('theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* ============ Setup: players ============ */
  const countInput = $('count-input');
  let nameInputs = [];

  // Remove the last empty name field, or the last field if none is empty
  function removeOne() {
    let idx = -1;
    for (let i = state.names.length - 1; i >= 0; i--) {
      if (!state.names[i].trim()) { idx = i; break; }
    }
    if (idx === -1) idx = state.names.length - 1;
    state.names.splice(idx, 1);
    state.total--;
  }

  function addOne() {
    state.names.push('');
    state.total++;
  }

  // Keep role counts inside the total (drop the last roles first)
  function clampRoles() {
    const order = ROLES.slice().reverse();
    while (assignedCount() > state.total) {
      const r = order.find((x) => state.counts[x.id] > x.min);
      if (!r) break;
      state.counts[r.id]--;
    }
  }

  function resizeTo(n) {
    while (state.total < n) addOne();
    while (state.total > n) removeOne();
    clampRoles();
    rebuildNames();
    syncAll();
  }

  $('count-plus').addEventListener('click', () => { addOne(); rebuildNames(); syncAll(); });
  $('count-minus').addEventListener('click', () => {
    if (state.total <= MIN_PLAYERS) return;
    removeOne(); clampRoles(); rebuildNames(); syncAll();
  });
  countInput.addEventListener('input', () => {
    const n = parseInt(countInput.value, 10);
    if (!isNaN(n) && n >= MIN_PLAYERS && n !== state.total) resizeTo(n);
  });
  countInput.addEventListener('blur', () => { countInput.value = state.total; });

  /* ============ Setup: roles ============ */
  const roleEls = {};
  let citizenOut = null;

  function buildRoles() {
    const list = $('roles-list');
    list.textContent = '';

    ROLES.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'role-row';
      row.dataset.role = r.id;
      row.innerHTML =
        '<span class="badge"></span>' +
        '<div class="role-info"><strong></strong><span></span></div>' +
        '<div class="counter">' +
          '<button type="button" data-act="dec"></button><output></output><button type="button" data-act="inc"></button>' +
        '</div>';
      row.querySelector('.badge').innerHTML = iconSvg(r.id);
      row.querySelector('strong').textContent = r.name;
      row.querySelector('.role-info span').textContent = r.short;
      const dec = row.querySelector('[data-act="dec"]');
      const inc = row.querySelector('[data-act="inc"]');
      dec.textContent = '−'; dec.setAttribute('aria-label', 'Fewer ' + r.name);
      inc.textContent = '+'; inc.setAttribute('aria-label', 'More ' + r.name);
      dec.dataset.role = r.id; inc.dataset.role = r.id;
      list.appendChild(row);
      roleEls[r.id] = { out: row.querySelector('output'), dec: dec, inc: inc };
    });

    const crow = document.createElement('div');
    crow.className = 'role-row';
    crow.dataset.role = 'citizen';
    crow.innerHTML =
      '<span class="badge"></span>' +
      '<div class="role-info"><strong>Citizen</strong><span>Automatic. Fills the remaining seats.</span></div>' +
      '<div class="counter static"><output></output></div>';
    crow.querySelector('.badge').innerHTML = iconSvg('citizen');
    list.appendChild(crow);
    citizenOut = crow.querySelector('output');
  }

  $('roles-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !b.dataset.role) return;
    const r = roleById(b.dataset.role);
    if (b.dataset.act === 'inc' && assignedCount() < state.total) state.counts[r.id]++;
    if (b.dataset.act === 'dec' && state.counts[r.id] > r.min) state.counts[r.id]--;
    syncAll();
  });

  /* ============ Setup: names ============ */
  function rebuildNames() {
    const list = $('names-list');
    list.textContent = '';
    nameInputs = [];

    state.names.forEach((val, i) => {
      const row = document.createElement('div');
      row.className = 'name-row';

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = (i + 1);

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.maxLength = 30;
      inp.autocomplete = 'off';
      inp.placeholder = 'Player ' + (i + 1);
      inp.value = val;
      inp.setAttribute('aria-label', 'Name of player ' + (i + 1));
      inp.addEventListener('input', () => { state.names[i] = inp.value; syncAll(); });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (nameInputs[i + 1]) nameInputs[i + 1].focus();
        else attemptStart();
      });

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'row-remove';
      rm.innerHTML = ICON_X;
      rm.setAttribute('aria-label', 'Remove player ' + (i + 1));
      rm.addEventListener('click', () => {
        if (state.total <= MIN_PLAYERS) return;
        state.names.splice(i, 1);
        state.total--;
        clampRoles();
        rebuildNames();
        syncAll();
      });

      row.appendChild(num);
      row.appendChild(inp);
      row.appendChild(rm);
      list.appendChild(row);
      nameInputs.push(inp);
    });
  }

  function validateNames() {
    const counts = {};
    const empty = [];
    state.names.forEach((n, i) => {
      const k = n.trim().toLowerCase();
      if (!k) empty.push(i);
      else counts[k] = (counts[k] || 0) + 1;
    });
    const dupKeys = Object.keys(counts).filter((k) => counts[k] > 1);
    return { empty: empty, dupKeys: dupKeys, ok: empty.length === 0 && dupKeys.length === 0 };
  }

  /* ============ Setup: sync everything ============ */
  function syncAll() {
    // count
    if (document.activeElement !== countInput) countInput.value = state.total;
    $('count-minus').disabled = state.total <= MIN_PLAYERS;
    document.querySelectorAll('.row-remove').forEach((b) => { b.disabled = state.total <= MIN_PLAYERS; });

    // roles
    const assigned = assignedCount();
    ROLES.forEach((r) => {
      const el = roleEls[r.id];
      el.out.textContent = state.counts[r.id];
      el.dec.disabled = state.counts[r.id] <= r.min;
      el.inc.disabled = assigned >= state.total;
    });
    citizenOut.textContent = state.total - assigned;

    const msgs = [];
    if (state.counts.mafia * 2 >= state.total) {
      msgs.push({ type: 'warn', text: 'Mafia is half or more of the players. The game will be hard for the citizens.' });
    }
    if (assigned >= state.total) {
      msgs.push({ type: 'warn', text: 'Every seat has a role. There will be no citizens.' });
    }
    setMessages($('roles-messages'), msgs);

    // names
    const v = validateNames();
    nameInputs.forEach((inp, i) => {
      const k = state.names[i].trim().toLowerCase();
      const isDup = k && v.dupKeys.indexOf(k) !== -1;
      const isEmpty = !k && state.tried;
      inp.classList.toggle('invalid', !!(isDup || isEmpty));
    });

    const status = $('status-text');
    if (v.dupKeys.length) {
      status.textContent = 'Each name must be different.';
      status.className = 'status error';
    } else if (v.empty.length) {
      status.textContent = v.empty.length + (v.empty.length === 1 ? ' name is missing.' : ' names are missing.');
      status.className = 'status' + (state.tried ? ' error' : '');
    } else {
      status.textContent = state.total + ' players ready: ' + state.counts.mafia + ' mafia, ' + (state.total - assigned) + ' citizens.';
      status.className = 'status';
    }
    return v;
  }

  function attemptStart() {
    const v = validateNames();
    if (!v.ok) {
      state.tried = true;
      syncAll();
      const firstBad = nameInputs.find((inp, i) => {
        const k = state.names[i].trim().toLowerCase();
        return !k || v.dupKeys.indexOf(k) !== -1;
      });
      if (firstBad) {
        firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
        firstBad.focus({ preventScroll: true });
      }
      return;
    }
    state.names = state.names.map((n) => n.trim());
    state.tried = false;
    assignRoles();
    showPass();
  }
  $('start-game').addEventListener('click', attemptStart);

  /* ============ Game ============ */
  function buildPool() {
    const pool = [];
    ROLES.forEach((r) => { for (let i = 0; i < state.counts[r.id]; i++) pool.push(r.id); });
    while (pool.length < state.total) pool.push('citizen');
    return pool;
  }

  function assignRoles() {
    const pool = shuffle(buildPool());
    state.assignments = state.names.map((name, i) => ({ name: name, role: pool[i], seen: false }));
    state.index = 0;
  }

  const progressText = () => 'Player ' + (state.index + 1) + ' of ' + state.assignments.length;

  function refreshProgress() {
    $('progress-text').textContent = progressText();
    $('reveal-progress').textContent = progressText();
    $('progress-bar').style.width = (state.index / state.assignments.length * 100) + '%';
    const last = state.index === state.assignments.length - 1;
    $('next-btn').textContent = last ? 'Finish' : 'Next';
  }

  function showPass() {
    $('role-card-slot').textContent = '';        // no role in the DOM while passing
    $('pass-name').textContent = state.assignments[state.index].name;
    refreshProgress();
    showScreen('screen-pass');
    $('reveal-btn').focus();
  }

  function showRole() {
    const cur = state.assignments[state.index];
    cur.seen = true;
    const role = roleById(cur.role);

    const card = document.createElement('div');
    card.className = 'role-card';
    card.dataset.role = role.id;

    const kicker = document.createElement('p');
    kicker.className = 'kicker';
    kicker.textContent = cur.name + ', you are';
    const name = document.createElement('div');
    name.className = 'role-name';
    name.textContent = role.name;
    const desc = document.createElement('p');
    desc.className = 'role-desc';
    desc.textContent = role.desc;
    card.appendChild(makeBadge(role.id, 'big'));
    card.appendChild(kicker);
    card.appendChild(name);
    card.appendChild(desc);

    if (role.id === 'mafia') {
      const mates = state.assignments.filter((p, i) => p.role === 'mafia' && i !== state.index);
      const team = document.createElement('div');
      team.className = 'team';
      const label = document.createElement('p');
      if (!mates.length) {
        label.textContent = 'You are the only Mafia member.';
        team.appendChild(label);
      } else {
        label.textContent = mates.length === 1 ? 'Your partner' : 'Your team';
        team.appendChild(label);
        const ul = document.createElement('ul');
        mates.forEach((m) => {
          const li = document.createElement('li');
          li.textContent = m.name;
          ul.appendChild(li);
        });
        team.appendChild(ul);
      }
      card.appendChild(team);
    }

    const slot = $('role-card-slot');
    slot.textContent = '';
    slot.appendChild(card);
    refreshProgress();
    showScreen('screen-reveal');
    $('next-btn').focus();
  }

  $('reveal-btn').addEventListener('click', showRole);

  $('next-btn').addEventListener('click', () => {
    $('role-card-slot').textContent = '';        // hide immediately
    state.index++;
    if (state.index < state.assignments.length) showPass();
    else { buildEnd(); showScreen('screen-end'); }
  });

  /* ============ Add player during the reveal ============ */
  const modal = $('add-modal');
  const addName = $('add-name');

  function openAdd() {
    addName.value = '';
    $('add-error').hidden = true;
    modal.hidden = false;
    addName.focus();
  }
  function closeAdd() {
    modal.hidden = true;
    $('add-player-btn').focus();
  }

  function confirmAdd() {
    const name = addName.value.trim();
    const err = $('add-error');
    if (!name) { err.textContent = 'Enter a name.'; err.hidden = false; addName.focus(); return; }
    const taken = state.names.some((n) => n.trim().toLowerCase() === name.toLowerCase());
    if (taken) { err.textContent = 'That name is already used.'; err.hidden = false; addName.focus(); return; }

    // Roles already shown stay as they are. Everything else is reshuffled.
    const keptRoles = state.assignments.filter((a) => a.seen).map((a) => a.role);
    state.total++;
    state.names.push(name);
    state.assignments.push({ name: name, role: null, seen: false });

    const pool = buildPool();
    keptRoles.forEach((r) => {
      const i = pool.indexOf(r);
      if (i !== -1) pool.splice(i, 1);
    });
    const rest = shuffle(pool);
    state.assignments.filter((a) => !a.seen).forEach((a, i) => { a.role = rest[i]; });

    modal.hidden = true;
    refreshProgress();
    toast(name + ' added. Remaining roles were reshuffled.');
  }

  $('add-player-btn').addEventListener('click', openAdd);
  $('add-cancel').addEventListener('click', closeAdd);
  $('add-confirm').addEventListener('click', confirmAdd);
  addName.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmAdd(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAdd(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeAdd(); });

  /* ============ End screen ============ */
  const releasers = [];

  function buildEnd() {
    // legend
    const legend = $('legend');
    legend.textContent = '';
    ROLES.concat([CITIZEN]).forEach((r) => {
      const n = state.assignments.filter((a) => a.role === r.id).length;
      if (!n) return;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.role = r.id;
      chip.appendChild(makeBadge(r.id, 'tiny'));
      chip.appendChild(document.createTextNode(r.name + ' ' + n));
      legend.appendChild(chip);
    });

    // player cards (press and hold to reveal)
    const grid = $('players-grid');
    grid.textContent = '';
    releasers.length = 0;

    state.assignments.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'player-card';
      const nm = document.createElement('span');
      nm.className = 'pc-name';
      nm.textContent = a.name;
      const rl = document.createElement('span');
      rl.className = 'pc-role';
      rl.textContent = 'Hold to reveal';
      const ic = document.createElement('span');
      ic.className = 'pc-icon';
      btn.appendChild(ic);
      btn.appendChild(nm);
      btn.appendChild(rl);

      const press = () => {
        btn.dataset.role = a.role;
        btn.classList.add('revealed');
        rl.textContent = roleById(a.role).name;
        ic.textContent = '';
        ic.appendChild(makeBadge(a.role, 'mini'));
      };
      const release = () => {
        btn.classList.remove('revealed');
        delete btn.dataset.role;
        rl.textContent = 'Hold to reveal';
        ic.textContent = '';
      };
      releasers.push(release);

      btn.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType !== 'mouse') press(); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, release));
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      btn.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); }
      });
      btn.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') release();
      });
      btn.addEventListener('blur', release);
      grid.appendChild(btn);
    });
  }

  function releaseAll() { releasers.forEach((f) => f()); }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  $('replay-btn').addEventListener('click', () => { assignRoles(); showPass(); });

  // Back to the setup page with every value kept
  $('edit-btn').addEventListener('click', () => {
    state.assignments = [];
    state.index = 0;
    $('players-grid').textContent = '';          // drop roles from the DOM
    rebuildNames();
    syncAll();
    showScreen('screen-setup');
  });

  /* ============ Install prompt (first visit only) ============ */
  (function () {
    const KEY = 'rm-install-seen';
    const banner = $('install-banner');
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch (e) {}
    if (standalone || seen) return;

    let deferred = null;
    const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch (e) {} };
    const hide = () => { banner.hidden = true; };

    function show(mode) {
      if (mode === 'ios') {
        $('install-desc').textContent = 'Tap the Share button in Safari, then choose Add to Home Screen. It will work offline.';
        $('install-btn').hidden = true;
        $('install-dismiss').textContent = 'Got it';
      } else {
        $('install-desc').textContent = 'Add it to your home screen to use it offline, like a normal app.';
        $('install-btn').hidden = false;
        $('install-dismiss').textContent = 'Not now';
      }
      banner.hidden = false;
      markSeen();                                  // never shown again after this
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      show('android');
    });
    window.addEventListener('appinstalled', () => { markSeen(); hide(); });

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && /^https?:$/.test(location.protocol)) show('ios');

    $('install-btn').addEventListener('click', () => {
      if (!deferred) { hide(); return; }
      deferred.prompt();
      Promise.resolve(deferred.userChoice).then(() => { deferred = null; hide(); }, hide);
    });
    $('install-dismiss').addEventListener('click', hide);
  })();

  /* ============ Init ============ */
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  buildRoles();
  rebuildNames();
  syncAll();
  showScreen('screen-setup');
})();
