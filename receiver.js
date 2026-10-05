/* Wargrim 3000 - custom Cast receiver.
   Message channel (phone -> TV), namespace urn:x-cast:com.wargrim.player, JSON objects:
     {type:'theme',  id:'metal', colors:{bg,surface,text,dim,accent,accent2}, reduce:bool, dwarf:bool}
     {type:'lyrics', key:'<same key as the item customData.key>', synced:true,  lines:[{t:12.5,text:'...'},...]}
                     {type:'lyrics', key:'...', synced:false, lines:[{text:'...'},...]}
                     {type:'lyrics', key:'...', lines:[]}         // no lyrics
     {type:'mood',   mood:'happy'|'angry'}                         // dwarf reacts for ~3 s
     {type:'settings', lyrics:bool, dwarf:bool, reduce:bool}
   The item's own metadata (title, artist, album, artwork) comes from the normal Cast media info. */
(function () {
  'use strict';
  var NS = 'urn:x-cast:com.wargrim.player';
  var RECEIVER_VERSION = '2026-10-05 fix-5';          // shows in the log, so you can tell which upload the TV is running
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;

  /* ---------------- log: Chrome (chrome://inspect or http://<TV>:9222) AND the phone's log file (tag TVLOG) ---------------- */
  var castCtx = null, phoneReady = false, phoneListening = false, history = [], logSecond = 0, logCount = 0;
  function log(msg) {
    var line = new Date().toISOString().substr(11, 12) + ' ' + msg;
    try { console.log('[WG] ' + line); } catch (e) {}
    if (history.length < 80) history.push(line);     // the first lines (version, keep-awake...) are re-sent once the phone listens
    if (!castCtx || !phoneListening) return;         // nobody to tell yet: sending now would only be lost
    sendLog(line, false);
  }
  function sendLog(line, force) {
    var now = Date.now();
    if (now - logSecond > 1000) { logSecond = now; logCount = 0; }
    if (!force && ++logCount > 15) return;           // at most 15 lines a second: never flood the channel
    try { castCtx.sendCustomMessage(NS, undefined, {type: 'log', text: line}); } catch (e) { try { console.warn('[WG] log send failed', e); } catch (x) {} }
  }
  /** The phone said something, so it is listening: send everything logged so far (the version line first). */
  function flushLog() {
    if (phoneListening) return;
    phoneListening = true;
    history.forEach(function (l) { sendLog(l, true); });
  }
  window.addEventListener('error', function (e) { log('JS ERROR: ' + (e.message || e) + ' at ' + (e.filename || '') + ':' + (e.lineno || '')); });
  window.addEventListener('unhandledrejection', function (e) { log('JS PROMISE ERROR: ' + (e.reason && (e.reason.message || e.reason))); });

  var state = {
    themeId: 'classic', reduce: false, showLyrics: true, showDwarf: true,
    key: null, lyricsByKey: {}, lines: [], synced: false, curIdx: -1,
    title: '', artist: '', album: '', art: '', dur: 0, pos: 0, playing: false, hasMedia: false,
    mood: 'neutral', moodUntil: 0
  };

  /* ---------------- helpers ---------------- */
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function themeOf(id) { return (window.WG_THEMES && window.WG_THEMES[id]) || window.WG_THEMES.classic; }

  /* ---------------- theme ---------------- */
  var activeTheme = themeOf('classic');
  /* ---- contrast: every text colour is checked against the background and moved toward white/black until it is readable ---- */
  function rgbOf(h) {
    h = String(h || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h.substr(0, 6), 16);
    return isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexOfRgb(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function lumOf(c) { var a = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function ratioOf(a, b) { var x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  /** [fg] moved toward white (dark background) or black (light background) until it has at least [min]:1 against [bg]. */
  function readable(fg, bg, min) {
    var c = rgbOf(fg), b = rgbOf(bg);
    if (ratioOf(c, b) >= min) return hexOfRgb(c);
    var toward = lumOf(b) < 0.4 ? [255, 255, 255] : [0, 0, 0];
    for (var t = 0.05; t <= 1.001; t += 0.05) { var m = mixRgb(c, toward, t); if (ratioOf(m, b) >= min) return hexOfRgb(m); }
    return hexOfRgb(toward);
  }

  function applyTheme(id, colors) {
    var t = Object.assign({}, themeOf(id));
    if (colors) for (var k in colors) if (colors[k]) t[k] = colors[k];
    activeTheme = t; state.themeId = id;
    var r = document.documentElement.style;
    // What the text really sits on: the theme background under the scrim, with up to ~30% of the album art showing through
    // (pessimistic mid-grey), so the checks hold whatever the cover looks like.
    var bgRgb = rgbOf(t.bg), isLight = !!t.light || lumOf(bgRgb) > 0.5;
    var behind = hexOfRgb(mixRgb(bgRgb, [128, 128, 128], 0.30));
    var textC = readable(t.text, behind, 7), dimC = readable(t.dim, behind, 4.5), accentText = readable(t.accent, behind, 4.5);
    if (textC !== t.text.toLowerCase() || dimC !== t.dim.toLowerCase() || accentText !== t.accent.toLowerCase()) {
      log('contrast: adjusted text ' + t.text + '->' + textC + ', dim ' + t.dim + '->' + dimC + ', accent text ' + t.accent + '->' + accentText + ' (on ' + behind + ')');
    }
    // Plain rgba() colours for the scrim, the lyrics panel and the glow (older TV browsers do not know color-mix(), and then drop the whole rule)
    function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')'; }
    var accRgb = rgbOf(t.accent);
    r.setProperty('--scrim', rgba(bgRgb, isLight ? 0.62 : 0.68)); r.setProperty('--panel', rgba(bgRgb, 0.72));
    r.setProperty('--glow55', rgba(accRgb, 0.55)); r.setProperty('--glow60', rgba(accRgb, 0.6));
    r.setProperty('--bg', t.bg); r.setProperty('--surface', t.surface); r.setProperty('--text', textC);
    r.setProperty('--dim', dimC); r.setProperty('--accent', t.accent); r.setProperty('--accent-text', accentText); r.setProperty('--accent2', t.accent2 || t.accent);
    r.setProperty('--title', "'" + t.title + "'"); r.setProperty('--body', "'" + t.body + "'");
    r.setProperty('--hue', (t.hue || 0) + 'deg');
    body.className = body.className.replace(/\bt-\S+/g, '').replace(/\blight\b/g, '').trim();
    body.classList.add('t-' + id.replace(/[^a-z0-9]/gi, ''));
    if (isLight) body.classList.add('light');
    // accessories (drawn on top of the dwarf, same pictures as the phone)
    var accs = $('accs'); accs.innerHTML = '';
    (t.acc || []).forEach(function (n) { var im = new Image(); im.src = 'img/dw_acc_' + n + '.png'; accs.appendChild(im); });
    fxSetup(t.fx);
    refreshFlags();
  }
  function refreshFlags() {
    body.classList.toggle('no-dwarf', !state.showDwarf);
    var noLy = !state.showLyrics || state.lines.length === 0;
    body.classList.toggle('no-lyrics', noLy);
    body.classList.toggle('state-idle', !state.hasMedia);
    body.classList.toggle('playing', !!state.playing);
  }

  /* ---------------- metadata ---------------- */
  function setMeta(m) {
    state.title = m.title || ''; state.artist = m.artist || ''; state.album = m.album || '';
    $('title').textContent = state.title || 'Wargrim 3000';
    $('artist').textContent = state.artist; $('album').textContent = state.album;
    if (m.art && m.art !== state.art) {
      state.art = m.art;
      $('art').src = m.art;
      $('bg').style.backgroundImage = "url('" + m.art.replace(/'/g, '%27') + "')";
    }
  }

  /* ---------------- lyrics ---------------- */
  function setLyrics(key, synced, lines) {
    state.lyricsByKey[key] = { synced: !!synced, lines: lines || [] };
    var keys = Object.keys(state.lyricsByKey); if (keys.length > 6) delete state.lyricsByKey[keys[0]];
    if (key === state.key) showLyricsFor(key);
  }
  function showLyricsFor(key) {
    var e = state.lyricsByKey[key];
    var list = $('lylist'); list.innerHTML = ''; state.curIdx = -1;
    log('lyrics shown for ' + String(key || '').split('/').pop() + ': ' + (!e ? 'none received yet' : e.lines.length + ' lines, synced=' + e.synced) + ' (lyrics on=' + state.showLyrics + ')');
    if (!e || !e.lines.length) { state.lines = []; state.synced = false; refreshFlags(); return; }
    state.lines = e.lines; state.synced = e.synced;
    var frag = document.createDocumentFragment();
    e.lines.slice(0, 400).forEach(function (l) {
      var d = document.createElement('div'); var txt = (l.text || '').trim();
      d.className = 'ly' + (txt ? '' : ' gap'); d.textContent = txt; frag.appendChild(d);
    });
    list.appendChild(frag); refreshFlags(); updateLyrics(true);
  }
  function lineIndexAt(sec) {
    var L = state.lines, i = -1;
    if (state.synced) { for (var k = 0; k < L.length; k++) { if (L[k].t <= sec + 0.15) i = k; else break; } }
    else if (state.dur > 0 && L.length) { i = Math.min(L.length - 1, Math.floor(sec / state.dur * L.length)); }
    return i;
  }
  function updateLyrics(force) {
    if (!state.lines.length) return;
    var i = lineIndexAt(state.pos);
    if (!force && i === state.curIdx) return;
    state.curIdx = i;
    var nodes = $('lylist').children, box = $('lyrics');
    for (var k = 0; k < nodes.length; k++) {
      var n = nodes[k], d = k - i;
      n.classList.toggle('cur', d === 0); n.classList.toggle('past', d < 0);
      n.classList.toggle('near', d > 0 && d <= 2);
    }
    var cur = nodes[Math.max(0, i)];
    if (cur) {
      var center = box.clientHeight * 0.46;
      $('lylist').style.transform = 'translateY(' + Math.round(center - (cur.offsetTop + cur.offsetHeight / 2)) + 'px)';
    }
  }

  /* ---------------- progress (4 times a second) ---------------- */
  function tick() {
    $('tcur').textContent = fmt(state.pos); $('tdur').textContent = fmt(state.dur);
    body.classList.toggle('playing', !!state.playing);
    $('fill').style.width = (state.dur > 0 ? Math.min(100, state.pos / state.dur * 100) : 0) + '%';
    updateLyrics(false);
  }
  setInterval(tick, 250);

  /* ---------------- dwarf ---------------- */
  var eyes = $('eyes'), brows = $('brows'), bob = document.querySelector('.dw-bob'), glow = document.querySelector('.dw-glow');
  var blinkUntil = 0, nextBlink = performance.now() + 3000, level = 0, fakePhase = 0;
  var analyser = null, freq = null, analyserTried = false;

  function tryAnalyser() {                      // best effort: read the beat from the audio the TV is playing
    if (analyserTried) return; analyserTried = true;
    try {
      var el = document.querySelector('video:not(#wg-keepalive),audio');
      if (!el) { var cmp = document.getElementById('cmp'); el = cmp && cmp.shadowRoot && cmp.shadowRoot.querySelector('video,audio'); }
      if (!el) { analyserTried = false; log('beat: no media element yet'); return; }
      // crossOrigin matters: audio from another address (the phone) routed into Web Audio WITHOUT it can come out SILENT
      log('beat: media element ' + el.tagName + ' crossOrigin=' + el.crossOrigin + ' src=' + String(el.currentSrc || el.src || '').substr(0, 60));
      // The music comes from the phone (another address). Routing such audio into Web Audio when the element is NOT in CORS mode
      // makes the browser output SILENCE (seen on the TV: crossOrigin=null, level 0, no sound). So only then is the analyser used;
      // otherwise the dwarf keeps its steady bob and the sound is left alone.
      if (!el.crossOrigin) { log('beat: skipped (crossOrigin not set, the sound would be muted); the dwarf uses the steady bob'); return; }
      var AC = window.AudioContext || window.webkitAudioContext; var ac = new AC();
      var src = ac.createMediaElementSource(el); analyser = ac.createAnalyser(); analyser.fftSize = 256;
      src.connect(analyser); analyser.connect(ac.destination); freq = new Uint8Array(analyser.frequencyBinCount);
      log('beat: analyser connected, audio context state=' + ac.state);
      setTimeout(function () {                      // 3 s later: is any sound coming through the analyser?
        if (!analyser) return;
        analyser.getByteFrequencyData(freq); var sum = 0; for (var i = 0; i < freq.length; i++) sum += freq[i];
        log('beat: 3 s check, audio level sum=' + sum + (sum === 0 && state.playing ? ' (ALL ZERO while playing: the sound may be muted)' : ''));
      }, 3000);
    } catch (e) { analyser = null; log('beat: analyser failed: ' + (e.message || e)); }
  }
  function bassLevel(now) {
    if (analyser) {
      analyser.getByteFrequencyData(freq); var s = 0; for (var i = 1; i < 6; i++) s += freq[i];
      return Math.min(1, Math.max(0, (s / 5 - 70) / 110));
    }
    fakePhase += 0.0105;                           // steady ~100 bpm bob when real audio data is not available
    var p = (now / 600) % 1; return state.playing ? Math.pow(Math.max(0, Math.cos(p * Math.PI * 2)), 6) * 0.6 : 0;
  }
  function dwarfFrame(now) {
    if (!state.showDwarf) return;
    var target = state.playing ? bassLevel(now) : 0;
    level += (target - level) * (target > level ? 0.55 : 0.12);
    var mood = (now < state.moodUntil) ? state.mood : 'neutral';
    var sy = 1 + level * (state.reduce ? 0.02 : 0.05), ty = -level * (state.reduce ? 0.6 : 1.6);
    bob.style.transform = 'translateY(' + ty + 'vh) scale(' + (1 / sy) + ',' + sy + ') rotate(' + (Math.sin(now / 1100) * (state.playing ? 1.6 : 0.4)) + 'deg)';
    glow.style.opacity = (0.12 + level * 0.5).toFixed(2);
    var eyeSrc = 'img/dw_eyes_open.png', browSrc = 'img/dw_brows.png';
    if (mood === 'happy') eyeSrc = 'img/dw_eyes_happy.png';
    else if (mood === 'angry') { eyeSrc = 'img/dw_eyes_angry.png'; browSrc = 'img/dw_brows_angry.png'; }
    else if (now < blinkUntil) eyeSrc = 'img/dw_eyes_closed.png';
    else if (now > nextBlink) { blinkUntil = now + 140; nextBlink = now + 2600 + Math.random() * 3200; }
    if (eyes.getAttribute('data-s') !== eyeSrc) { eyes.src = eyeSrc; eyes.setAttribute('data-s', eyeSrc); }
    if (brows.getAttribute('data-s') !== browSrc) { brows.src = browSrc; brows.setAttribute('data-s', browSrc); }
  }

  /* ---------------- background scenes (one 30 fps canvas, light on purpose: a Chromecast is slow) ---------------- */
  var cv = $('fx'), cx = cv.getContext('2d'), fx = 'none', parts = [], gridT = 0, lastFx = 0, W = 0, H = 0;
  function resize() { W = cv.width = Math.round(window.innerWidth / 2); H = cv.height = Math.round(window.innerHeight / 2); }
  window.addEventListener('resize', resize); resize();
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function fxSetup(kind) {
    fx = kind || 'none'; parts = []; var n = state.reduce ? 0 : ({embers: 38, sparks: 26, dust: 30, rain: 70, notes: 16, particles: 46, smoke: 14, waves: 0, grid: 0, none: 0}[fx] || 0);
    for (var i = 0; i < n; i++) parts.push(newPart(true));
    cx.clearRect(0, 0, W, H);
  }
  function newPart(init) {
    var p = {x: rnd(0, W), y: init ? rnd(0, H) : H + 10, r: rnd(1, 3), v: rnd(.15, .6), a: rnd(.3, .9), ph: rnd(0, 6.28)};
    if (fx === 'rain') { p.y = init ? rnd(0, H) : -10; p.v = rnd(3, 6); p.len = rnd(8, 18); }
    if (fx === 'notes') { p.x = init ? rnd(0, W) : -20; p.y = rnd(H * .15, H * .75); p.v = rnd(.2, .5); p.r = rnd(10, 20); }
    if (fx === 'smoke') { p.r = rnd(40, 90); p.v = rnd(.1, .3); p.a = rnd(.03, .07); }
    if (fx === 'sparks') { p.v = rnd(.5, 1.2); }
    return p;
  }
  function drawFx(now) {
    if (now - lastFx < 33) return; lastFx = now;
    cx.clearRect(0, 0, W, H);
    if (state.reduce || fx === 'none') return;
    var t = activeTheme, acc = t.accent, boost = 1 + level * 1.5;
    if (fx === 'grid') {
      var hz = H * 0.58; gridT = (gridT + (state.playing ? 0.6 : 0.1) * boost) % 40;
      var sg = cx.createLinearGradient(0, hz - H * .3, 0, hz); sg.addColorStop(0, t.accent2 || '#ff4fd8'); sg.addColorStop(1, '#ffb35c');
      cx.fillStyle = sg; cx.globalAlpha = .38; cx.beginPath(); cx.arc(W * .72, hz - H * .06, H * .22, 0, 6.28); cx.fill();
      cx.globalAlpha = 1; cx.fillStyle = t.bg; for (var s = 0; s < 8; s++) cx.fillRect(W * .72 - H * .24, hz - H * .12 + s * H * .02, H * .48, 1 + s * .6);
      cx.strokeStyle = acc; cx.globalAlpha = .45; cx.lineWidth = 1; cx.beginPath();
      for (var i = -12; i <= 12; i++) { cx.moveTo(W / 2 + i * 8, hz); cx.lineTo(W / 2 + i * 70, H); }
      for (var j = 0; j < 12; j++) { var yy = hz + Math.pow((j * 40 + gridT) / 480, 2.2) * (H - hz) * 1.3; if (yy < H) { cx.moveTo(0, yy); cx.lineTo(W, yy); } }
      cx.stroke(); cx.globalAlpha = 1; return;
    }
    if (fx === 'waves') {
      for (var w = 0; w < 3; w++) {
        cx.beginPath(); cx.fillStyle = [t.accent3 || '#2f9e44', t.accent, t.accent2 || '#e23a2e'][w]; cx.globalAlpha = .30;
        cx.moveTo(0, H); for (var x = 0; x <= W; x += 8) cx.lineTo(x, H * (.84 + w * .03) + Math.sin(x / (60 + w * 20) + now / (900 + w * 300)) * (6 + level * 10));
        cx.lineTo(W, H); cx.fill();
      } cx.globalAlpha = 1; return;
    }
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      if (fx === 'embers' || fx === 'sparks' || fx === 'dust' || fx === 'particles') {
        p.y -= p.v * boost; p.x += Math.sin(now / 900 + p.ph) * .3;
        if (fx === 'dust') { p.y += p.v * boost * 1.3; p.x += .25; if (p.y > H) { parts[k] = newPart(false); parts[k].y = -5; } }
        else if (p.y < -10) parts[k] = newPart(false);
        cx.globalAlpha = p.a * (fx === 'dust' ? .4 : .8); cx.fillStyle = (fx === 'embers') ? '#ff7a2e' : (fx === 'dust' ? '#f0d9a8' : acc);
        cx.beginPath(); cx.arc(p.x, p.y, p.r * (fx === 'particles' ? .8 + level : 1), 0, 6.28); cx.fill();
      } else if (fx === 'rain') {
        p.y += p.v; p.x -= .6; if (p.y > H) { parts[k] = newPart(false); parts[k].y = -10; }
        cx.globalAlpha = .28; cx.strokeStyle = '#bcd0ff'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x + .6 * p.len / 4, p.y - p.len); cx.stroke();
      } else if (fx === 'notes') {
        p.x += p.v; if (p.x > W + 20) parts[k] = newPart(false);
        cx.globalAlpha = .22; cx.fillStyle = t.accent; cx.font = Math.round(p.r) + 'px serif'; cx.fillText('♪', p.x, p.y + Math.sin(now / 1500 + p.ph) * 8);
      } else if (fx === 'smoke') {
        p.y -= p.v; p.x += Math.sin(now / 2500 + p.ph) * .35; if (p.y < -90) { parts[k] = newPart(false); parts[k].y = H + 90; }
        var g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); g.addColorStop(0, 'rgba(255,230,190,' + p.a + ')'); g.addColorStop(1, 'rgba(255,230,190,0)');
        cx.globalAlpha = 1; cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.28); cx.fill();
      }
    }
    cx.globalAlpha = 1;
  }
  function frame(now) { dwarfFrame(now); drawFx(now); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);

  /* ---------------- messages from the phone ---------------- */
  function onMessage(d) {
    flushLog();                                       // the first message proves the phone is listening
    if (!d || typeof d !== 'object') { log('message ignored (not an object): ' + String(d).substr(0, 80)); return; }
    if (d.type === 'theme') log('got theme ' + d.id + ' colors=' + JSON.stringify(d.colors || {}) + ' reduce=' + d.reduce + ' dwarf=' + d.dwarf);
    else if (d.type === 'lyrics') log('got lyrics for ' + String(d.key || '').split('/').pop() + ': ' + (d.lines ? d.lines.length : 0) + ' lines, synced=' + d.synced);
    else if (d.type === 'settings') log('got settings lyrics=' + d.lyrics + ' dwarf=' + d.dwarf + ' reduce=' + d.reduce);
    else if (d.type === 'mood') log('got mood ' + d.mood);
    else log('got unknown message type ' + d.type);
    if (d.type === 'theme') {
      if (typeof d.reduce === 'boolean') state.reduce = d.reduce;
      if (typeof d.dwarf === 'boolean') state.showDwarf = d.dwarf;
      applyTheme(d.id || 'classic', d.colors);
    } else if (d.type === 'settings') {
      if (typeof d.lyrics === 'boolean') state.showLyrics = d.lyrics;
      if (typeof d.dwarf === 'boolean') state.showDwarf = d.dwarf;
      if (typeof d.reduce === 'boolean') { state.reduce = d.reduce; fxSetup(activeTheme.fx); }
      refreshFlags();
    } else if (d.type === 'lyrics') {
      setLyrics(String(d.key || ''), d.synced !== false && d.lines && d.lines.length && d.lines[0].t !== undefined, d.lines || []);
    } else if (d.type === 'mood') {
      state.mood = d.mood === 'angry' ? 'angry' : 'happy'; state.moodUntil = performance.now() + 3000;
    }
  }

  /* ---------------- keep the TV screen on: no screensaver / wallpapers while the page is up ---------------- */
  var awake = {lock: null, video: null, tick: null};
  function keepScreenOn() {
    // 1. the Screen Wake Lock API, where this TV's browser has it
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        var ask = function () {
          navigator.wakeLock.request('screen').then(function (l) {
            awake.lock = l; log('keep-awake: screen wake lock granted');
            l.addEventListener('release', function () { awake.lock = null; log('keep-awake: wake lock released by the system'); });
          }).catch(function (e) { log('keep-awake: wake lock refused: ' + (e.message || e)); });
        };
        ask();
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && !awake.lock) ask(); });
      } else { log('keep-awake: this TV has no wake lock API (using the keep-alive video only)'); }
    } catch (e) { log('keep-awake: wake lock error: ' + (e.message || e)); }
    // 2. a tiny live video that is always playing (TVs normally keep the display on while any video plays). It is muted, 4 px,
    //    nearly invisible, and has its own id so the beat analyser never mistakes it for the music.
    try {
      var cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
      var g = cv.getContext('2d'), n = 0;
      var v = document.createElement('video');
      v.id = 'wg-keepalive'; v.muted = true; v.loop = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
      v.style.cssText = 'position:fixed;right:0;bottom:0;width:4px;height:4px;opacity:0.02;pointer-events:none;z-index:-1';
      v.srcObject = cv.captureStream(4);
      document.body.appendChild(v);
      var paint = function () { g.fillStyle = 'rgb(' + ((n * 7) % 40) + ',0,0)'; g.fillRect(0, 0, 16, 16); n++; };
      paint(); awake.tick = setInterval(paint, 500);       // a changing picture, so the stream keeps producing frames
      var go = function () {
        var p = v.play();
        if (p && p.then) p.then(function () { log('keep-awake: keep-alive video playing'); }).catch(function (e) { log('keep-awake: keep-alive video refused: ' + (e.message || e)); });
      };
      go(); awake.video = v;
      setInterval(function () { if (v.paused) go(); }, 5000);
    } catch (e) { log('keep-awake: keep-alive video error: ' + (e.message || e)); }
  }

  /* ---------------- Cast framework ---------------- */
  function startCast() {
    var ctx = cast.framework.CastReceiverContext.getInstance();
    var pm = ctx.getPlayerManager();
    var E = cast.framework.events.EventType;
    castCtx = ctx;
    log('receiver ' + RECEIVER_VERSION + ' starting; ' + navigator.userAgent);
    try {                                              // what this TV's browser can do (the page must not rely on newer CSS)
      log('browser: color-mix=' + (window.CSS && CSS.supports && CSS.supports('color', 'color-mix(in srgb, red 50%, blue)')) +
        ' inset=' + (window.CSS && CSS.supports && CSS.supports('inset', '0')) + ' screen=' + screen.width + 'x' + screen.height + ' dpr=' + window.devicePixelRatio);
    } catch (e) { log('browser check failed: ' + (e.message || e)); }
    ctx.addEventListener(cast.framework.system.EventType.SENDER_CONNECTED, function (e) { phoneReady = true; log('phone connected (' + (e.senderId || '?') + ')'); });
    ctx.addEventListener(cast.framework.system.EventType.SENDER_DISCONNECTED, function (e) { log('phone disconnected, reason ' + (e.reason || '?')); });
    ctx.addCustomMessageListener(NS, function (e) { var d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { log('message is not JSON: ' + d.substr(0, 80)); return; } } onMessage(d); });
    var lastState = '';
    function pull() {
      var mi = pm.getMediaInformation(); if (!mi) return;
      var md = mi.metadata || {}; var cd = mi.customData || {};
      var key = String(cd.key || mi.contentId || '');
      var img = md.images && md.images.length ? md.images[0].url : '';
      state.hasMedia = true;
      if (key !== state.key) {
        log('song: ' + (md.title || '?') + ' / ' + (md.artist || md.albumArtist || '?') + ' key=' + key.split('/').pop() + (cd.key ? '' : ' (NO customData.key)') + ' art=' + (img ? 'yes' : 'no'));
        state.key = key; state.pos = 0; showLyricsFor(key);
      }
      setMeta({title: md.title, artist: md.artist || md.albumArtist, album: md.albumName, art: img});
      state.dur = pm.getDurationSec() || mi.duration || 0;
      refreshFlags();
    }
    function clock() {
      state.pos = pm.getCurrentTimeSec() || 0;
      var ps = pm.getPlayerState ? String(pm.getPlayerState()) : '?';
      if (ps !== lastState) { log('player state ' + lastState + ' -> ' + ps + ' at ' + fmt(state.pos)); lastState = ps; }
      state.playing = pm.getPlayerState && pm.getPlayerState() === cast.framework.messages.PlayerState.PLAYING;
      if (state.playing) tryAnalyser();
    }
    // Listen by NAME, and skip a name this TV's Cast library doesn't have. (An unknown name used to throw here, BEFORE ctx.start():
    // the TV showed the page but never told the phone it was ready, and every cast failed after 60 s with code 2473.)
    function on(name, fn) {
      var t = E[name];
      if (!t) { log('event ' + name + ' does not exist here, skipped'); return; }
      try { pm.addEventListener(t, fn); } catch (e) { log('could not listen to ' + name + ': ' + (e.message || e)); }
    }
    try {
      ['MEDIA_STATUS', 'PLAYER_LOAD_COMPLETE', 'PLAYING', 'PAUSE', 'SEEKED'].forEach(function (n) { on(n, function () { pull(); clock(); }); });
      on('TIME_UPDATE', clock);
      on('MEDIA_FINISHED', function () { state.playing = false; log('song finished'); });
      on('ERROR', function (e) { log('PLAYER ERROR: code ' + (e.detailedErrorCode || '?') + ' ' + (e.error ? JSON.stringify(e.error).substr(0, 200) : '')); });
    } catch (e) {
      log('listener setup failed: ' + (e.message || e));
    }
    setInterval(function () { try { pull(); clock(); } catch (e) { } }, 250);
    var opts = new cast.framework.CastReceiverOptions();
    opts.maxInactivity = 1800;                     // stay up during a long pause
    opts.customNamespaces = {}; opts.customNamespaces[NS] = cast.framework.system.MessageType.JSON;
    keepScreenOn();
    log('starting the Cast receiver (namespace ' + NS + ')');
    ctx.start(opts);
    log('Cast receiver started');
  }

  /* ---------------- demo mode: open index.html?demo=1&theme=metal&lyrics=1&dwarf=1 in any browser ---------------- */
  function startDemo(q) {
    var theme = q.get('theme') || 'classic';
    state.reduce = q.get('reduce') === '1'; state.showDwarf = q.get('dwarf') !== '0';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8a23c"/><stop offset=".55" stop-color="#b8344a"/><stop offset="1" stop-color="#2a2f6e"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><circle cx="560" cy="250" r="130" fill="#ffd27a" opacity=".85"/><path d="M0 560 L180 420 L330 540 L520 380 L800 600 V800 H0Z" fill="#14172e" opacity=".9"/></svg>';
    var art = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    applyTheme(theme);
    state.hasMedia = true; state.key = 'demo'; state.playing = true; state.dur = 214; state.pos = Number(q.get('t') || 62);
    setMeta({title: q.get('title') || 'Midnight Over the Mountains', artist: 'Demo Artist', album: 'Demo Album', art: art});
    if (q.get('lyrics') !== '0') {
      var words = ['Under a sky of iron and flame', 'We carry the thunder home', 'Every road remembers our name', 'Every torch burns for the road', '', 'Hold the line when the night comes down', 'Sing it loud for the ones we lost', 'Raise the song and the hammer high', 'Nothing here is left undone', '', 'Down in the deep where the old fires glow', 'The dwarves keep the beat in stone', 'Louder now, let the whole world know', 'You are never walking alone'];
      var lines = words.map(function (w, i) { return {t: 8 + i * 6.4, text: w}; });
      setLyrics('demo', true, lines);
    } else { showLyricsFor('demo'); }
    if (q.get('mood')) { state.mood = q.get('mood'); state.moodUntil = performance.now() + 600000; }
    var t0 = performance.now() - state.pos * 1000;
    setInterval(function () { state.pos = (performance.now() - t0) / 1000; if (state.pos > state.dur) t0 = performance.now(); }, 250);
    refreshFlags();
  }

  (function () {                                    // the version label in the corner, for the first 14 seconds
    var v = document.getElementById('ver');
    if (v) { v.textContent = 'Wargrim TV page ' + RECEIVER_VERSION.split(' ').pop(); setTimeout(function () { v.className = 'gone'; }, 14000); }
  })();
  applyTheme('classic');
  var q = new URLSearchParams(location.search);
  if (q.get('demo') === '1' || !(window.cast && cast.framework)) { log('demo mode (no Cast framework or ?demo=1)'); startDemo(q); }
  else { try { startCast(); } catch (e) { log('START FAILED: ' + (e.message || e)); console.error(e); } }
})();
