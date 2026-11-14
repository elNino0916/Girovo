# Logo versions for the MT-Media mocks, made from the two PNGs in public/brand/.
#
#   *-dark.png    full colour for dark surfaces: the near-black letters lifted to
#                 Girovo's light ink (#dde3ee), the blues lifted to stay bright on #252a33
#   *-mono-light.png  one colour, Girovo's dark-theme ink
#   *-mono-ink.png    one colour, Girovo's light-theme ink (#161c24)
#   *-mono-blue.png   one colour, Girovo's primary per theme (#0060a8 light, #a2c9ff dark)
#
# Run from anywhere: python logos.py
import colorsys
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '..', '..', 'public', 'brand')


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def on_dark(px):
    r, g, b, a = px
    if a == 0:
        return px
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    # How much of a blue this pixel is: saturated and bluish hue; the letters are near-black navy.
    blue = smooth(0.25, 0.55, s) * smooth(0.03, 0.12, l)
    ink = hexrgb('#dde3ee')
    # Blues lifted so the darkest navy still reads on a dark surface.
    bl = 0.50 + l * 0.55
    br, bg, bb = colorsys.hls_to_rgb(h, min(bl, 0.82), min(1.0, s * 1.0))
    out = [ink[i] / 255 * (1 - blue) + (br, bg, bb)[i] * blue for i in range(3)]
    return (round(out[0] * 255), round(out[1] * 255), round(out[2] * 255), a)


def mono(px, color):
    c = hexrgb(color)
    return (c[0], c[1], c[2], px[3])


for name in ('mark', 'wordmark'):
    im = Image.open(os.path.join(SRC, f'mt-media-{name}.png')).convert('RGBA')
    data = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
    for suffix, fn in (
        ('dark', on_dark),
        ('mono-light', lambda p: mono(p, '#dde3ee')),
        ('mono-ink', lambda p: mono(p, '#161c24')),
        ('mono-blue-light', lambda p: mono(p, '#0060a8')),
        ('mono-blue-dark', lambda p: mono(p, '#a2c9ff')),
    ):
        out = Image.new('RGBA', im.size)
        out.putdata([fn(p) for p in data])
        out.save(os.path.join(HERE, f'{name}-{suffix}.png'))
    im.save(os.path.join(HERE, f'{name}.png'))
print('ok')
