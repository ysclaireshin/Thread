import base64, random, pathlib

SCRATCH = pathlib.Path(__file__).parent
FONTS = SCRATCH / 'fonts'
if not FONTS.is_dir():
    FONTS = pathlib.Path('/Users/yeonseoshin/Downloads/thread-solar/dist/fonts')
OUT = pathlib.Path('/Users/yeonseoshin/Desktop/thread-hero.html')
# Vercel deploy folder: drag THIS FOLDER (not the bare html) so vercel.json
# ships too - it holds the rewrites that proxy Plausible past ad blockers.
DEPLOY_DIR = pathlib.Path('/Users/yeonseoshin/Desktop/thread-deploy')

html = (SCRATCH / 'template.html').read_text()

def b64(name):
    return base64.b64encode((FONTS / name).read_bytes()).decode()

html = html.replace('@@GEIST_400@@', b64('Geist-Regular.woff2'))
html = html.replace('@@GEIST_500@@', b64('Geist-Medium.woff2'))
html = html.replace('@@GEIST_600@@', b64('Geist-SemiBold.woff2'))
# Geist Mono intentionally NOT embedded: nothing on the page uses mono, so
# shipping those two faces was ~135KB of base64 for zero visual benefit.

# Starfield: static dots, alpha clamped 0.15-0.35 to match app's drawStarfield
rng = random.Random(42)
def shadows(n, spread_x, spread_y):
    out = []
    for _ in range(n):
        x = int(rng.uniform(-spread_x, spread_x))
        y = int(rng.uniform(-spread_y, spread_y))
        a = round(rng.uniform(0.15, 0.35), 2)
        out.append(f'{x}px {y}px rgba(255,255,255,{a})')
    return ', '.join(out)

# Star counts kept deliberately low: each shadow is repainted whenever the
# parallax transform moves the layer, so 100+ shadows made scrolling janky.
html = html.replace('@@STARS_SM@@', shadows(34, 950, 620))
html = html.replace('@@STARS_LG@@', shadows(8, 900, 580))

OUT.write_text(html)
print(f'wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB)')

# Same page as index.html inside the deploy folder, so it serves at the site
# root and sits next to vercel.json.
DEPLOY_DIR.mkdir(exist_ok=True)
(DEPLOY_DIR / 'index.html').write_text(html)
print(f'wrote {DEPLOY_DIR}/index.html  <- drag the thread-deploy FOLDER to Vercel')
