import pathlib, sys

P = pathlib.Path(__file__).parent / 'template.html'
s = P.read_text()

def rep(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f'{label}: expected 1 occurrence, found {n}'
    s = s.replace(old, new)

def cut_between(start, end, replacement, label):
    """Replace [start..end) with replacement (end marker kept)."""
    global s
    i = s.find(start)
    j = s.find(end)
    assert i != -1 and j != -1 and i < j, f'{label}: markers not found or out of order'
    s = s[:i] + replacement + s[j:]

# ── CSS: excise Linear-view block, insert pain-section styles ─────────────
PAIN_CSS = '''/* ══ SECTION 2 — pain statement (no headline, no label, no CTA) ═══════ */
.pain {
  position:relative; z-index:2;
  max-width:560px; margin:0 auto;
  padding:80px 24px;
}
.pain p {
  font-family:var(--font-sans); font-size:18px; font-weight:400;
  color:var(--text-secondary); line-height:1.65;
  text-align:center;
}

'''
cut_between('/* ══ ACT 2 — Linear view glimpse',
            '/* ══ ACT 3 — Map view glimpse',
            PAIN_CSS, 'linear CSS block')
rep('/* ══ ACT 3 — Map view glimpse', '/* ══ SECTION 3 — Map view glimpse', 'map css header')
rep('/* ══ ACT 4 — closing CTA ═', '/* ══ SECTION 4 — closing CTA ═', 'closing css header')

# ── CSS: closing tweaks ───────────────────────────────────────────────────
rep('''.closing .price { margin-top:30px; }
.closing .signup { margin-top:14px; opacity:1; transform:none; }
.closing form.cta { margin:0 auto; }
.closing .form-done { justify-content:center; }
/* closing reveals ride the .reveal system, not the hero .in system */
.closing .price, .closing .signup { animation:none; }''',
'''.closing .aud {
  font-family:var(--font-sans); font-size:13px;
  color:var(--text-secondary);
  margin-bottom:16px;
}
.closing form.cta { margin:0 auto; }
.closing .form-done { justify-content:center; }''', 'closing css')

# ── CSS: responsive + reduced-motion cleanup ──────────────────────────────
rep('''  .intro-tag { top:auto; bottom:26vh; }
  .panel { grid-template-columns:1fr; }
  .draft-pane { border-right:none; border-bottom:1px solid var(--border); }
  .view-section { padding-top:14vh; }''',
'''  .view-section { padding-top:14vh; }''', 'media 1000')
rep('''@media (max-width: 600px) {
  .tag .txt, .sun-tag .txt { display:none; }
  .draft-body { font-size:13px; }
}''',
'''@media (max-width: 600px) {
  .tag .txt, .sun-tag .txt { display:none; }
}''', 'media 600')
rep('''@media (prefers-reduced-motion: reduce) {
  .scene { height:100vh; }
  .orbit, .holder, .sun, .scroll-hint i, .caret, .focus-ring,
  .row.focusrow .bar { animation:none !important; }''',
'''@media (prefers-reduced-motion: reduce) {
  .orbit, .holder, .sun, .focus-ring { animation:none !important; }''', 'reduced 1')
rep('  .in .w, .in .price, .in .signup { animation:none; opacity:1; transform:none; }',
    '  .in .w, .in .bridge, .in .cta-scroll { animation:none; opacity:1; transform:none; }', 'reduced 2')

# ── Markup: hero content in on load, single CTA, no price/email, no intro ─
rep('<main class="content" id="hero-content">', '<main class="content in" id="hero-content">', 'content in')
rep('''        <div id="sun-anchor"></div>
        <div class="sun" id="sun"></div>''',
   '''        <div class="sun" id="sun"></div>''', 'sun anchor')
rep('''      <div class="price">$12<span class="per">/month</span></div>
      <div class="signup">
        <form class="cta">
          <input type="email" name="email" placeholder="you@example.com" required aria-label="Email address">
          <button class="go" type="submit">Get early access</button>
        </form>
        <div class="form-done" hidden>Thanks — you're on the list.</div>
      </div>
    </main>

    <div class="intro-tag" id="intro-tag">Where unfinished thinking lives</div>
    <div class="scroll-hint" id="scroll-hint"><i></i>Scroll</div>
  </div>
</section>''',
'''      <div class="bridge">
        <span class="ask">Sound familiar?</span>
        <span class="quote">“I scroll up and down for 3 hours skimming until I notice something to edit.”</span>
      </div>
      <button class="cta-scroll" id="cta-see" type="button">See how it works ↓</button>
    </main>
  </div>
</section>

<!-- ══ SECTION 2: pain statement ══ -->
<section class="pain">
  <p class="reveal" style="--i:0">Most people who work on long projects don't fail from lack of ideas. They fail because every time they stop, the map disappears. Coming back means reconstructing where you were before you can write a single useful sentence.</p>
</section>''', 'hero tail + pain section')

# ── Markup: remove Linear section entirely ────────────────────────────────
cut_between('<!-- ══ ACT 2: Linear view ══ -->',
            '<!-- ══ ACT 3: Map view ══ -->',
            '', 'linear markup')
rep('<!-- ══ ACT 3: Map view ══ -->', '<!-- ══ SECTION 3: Map view ══ -->', 'map markup header')
rep('<!-- ══ ACT 4: closing CTA ══ -->', '<!-- ══ SECTION 4: closing CTA ══ -->', 'closing markup header')

# ── Markup: map copy (manual connections, keep node content) ─────────────
rep('<h2 class="reveal" style="--i:1">See it as a system.</h2>',
    '<h2 class="reveal" style="--i:1">See how your ideas connect.</h2>', 'map h2')
rep('<p class="lead reveal" style="--i:2">The same thread as a living map — clusters find each other, tensions stay visible as dashed lines, and the question you left open stays lit. Hover a node to see what it touches.</p>',
    '<p class="lead reveal" style="--i:2">The same ideas as a living map. Connect related thoughts, see tensions at a glance, and the question you left open stays lit until you answer it.</p>', 'map lead')
rep('<div class="map-note">hover a node · your added thoughts land here too</div>',
    '<div class="map-note">hover a node · shift-click two nodes to connect them</div>', 'map note')

# ── Markup: closing ───────────────────────────────────────────────────────
rep('''<section class="closing">
  <h2 class="reveal" style="--i:0">Start where you left off.</h2>
  <p class="lead reveal" style="--i:1">One place for the thinking between sessions.</p>
  <div class="price reveal" style="--i:2">$12<span class="per">/month</span></div>
  <div class="signup reveal" style="--i:3">''',
'''<section class="closing">
  <p class="aud reveal" style="--i:0">Built for students, researchers, and anyone doing sustained analytical work — writing or code.</p>
  <h2 class="reveal" style="--i:1">Pick up exactly where your thinking left off.</h2>
  <p class="lead reveal" style="--i:2">One place for the thinking between sessions.</p>
  <div class="price reveal" style="--i:3">$12<span class="per">/month</span></div>
  <div class="signup reveal" style="--i:4">''', 'closing markup')

# ── JS: drop pin engine pieces ────────────────────────────────────────────
rep('''  var easeInOut = function (t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; };
  var easeOut''', '''  var easeOut''', 'easeInOut')
rep('''  var scene = document.getElementById('hero-scene');
  var sun = document.getElementById('sun');
  var anchor = document.getElementById('sun-anchor');
  var system = document.getElementById('system');
  var heroContent = document.getElementById('hero-content');
  var introTag = document.getElementById('intro-tag');
  var hint = document.getElementById('scroll-hint');
  var progress''', '''  var progress''', 'js vars')
cut_between('  /* ── Sun travel:', '  /* ── Map edges', '', 'measureSun')

i = s.find("    if (reduced) return;\n\n    /* hero pin */")
j = s.find("    /* map edge drawing")
assert i != -1 and j != -1 and i < j, 'frame pin block markers'
s = s[:i] + "    if (reduced) return;\n\n" + s[j:]

rep("  addEventListener('resize', function () { needMeasure = true; onScroll(); }, { passive: true });",
    "  addEventListener('resize', onScroll, { passive: true });", 'resize')
rep('''  if (reduced) {
    system.style.setProperty('--sysop', '1');
    system.style.setProperty('--labop', '1');
    heroContent.classList.add('in');
    introTag.style.display = 'none';
    hint.style.display = 'none';
    sun.style.transform = 'translate(-50%,-50%)';
    mapCard.classList.add('map-drawn');
  }
  frame();
  /* fonts/layout settle → remeasure once */
  addEventListener('load', function () { needMeasure = true; onScroll(); });''',
'''  if (reduced) { mapCard.classList.add('map-drawn'); }
  frame();''', 'reduced init')

# ── JS: remove try-it block, add hero CTA scroll ─────────────────────────
cut_between("  /* ── Try-it: typed thought lands in outline AND map",
            "  /* ── Email capture",
            '''  /* ── Hero CTA: scroll to the demo ──────────────────────────────────── */
  document.getElementById('cta-see').addEventListener('click', function () {
    document.getElementById('map-sec').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });

''', 'try-it block')

P.write_text(s)
print('restructure OK')
