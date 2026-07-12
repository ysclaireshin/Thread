import base64, random, pathlib

SCRATCH = pathlib.Path(__file__).parent
FONTS = pathlib.Path('/Users/yeonseoshin/Downloads/thread-solar/dist/fonts')
OUT = pathlib.Path('/Users/yeonseoshin/Desktop/thread-hero.html')

html = (SCRATCH / 'template.html').read_text()

def b64(name):
    return base64.b64encode((FONTS / name).read_bytes()).decode()

html = html.replace('@@GEIST_400@@', b64('Geist-Regular.woff2'))
html = html.replace('@@GEIST_500@@', b64('Geist-Medium.woff2'))
html = html.replace('@@GEIST_600@@', b64('Geist-SemiBold.woff2'))
html = html.replace('@@MONO_400@@', b64('GeistMono-Regular.woff2'))
html = html.replace('@@MONO_500@@', b64('GeistMono-Medium.woff2'))

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

html = html.replace('@@STARS_SM@@', shadows(90, 950, 620))
html = html.replace('@@STARS_LG@@', shadows(16, 900, 580))

OUT.write_text(html)
print(f'wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB)')
