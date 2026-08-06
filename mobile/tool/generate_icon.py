#!/usr/bin/env python3
"""Generates the launcher icon sources in assets/icon/.

Written by hand because the machine has neither Pillow nor ImageMagick, and the
tenge sign is three rectangles — two horizontal bars and a stem — so a tiny
rasteriser with supersampled edges is enough and keeps the icon reproducible.

    python3 tool/generate_icon.py && dart run flutter_launcher_icons
"""

import os
import struct
import zlib

SIZE = 1024
SUPERSAMPLE = 4

TEAL = (0x0D, 0x94, 0x88)
WHITE = (0xFF, 0xFF, 0xFF)


def write_png(path, width, height, pixels):
    """pixels: flat bytearray of RGBA rows."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0
        raw.extend(pixels[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    with open(path, 'wb') as handle:
        handle.write(png)


def tenge_rects(size, scale):
    """Rectangles making up ₸, centred in a `size` canvas.

    Proportions: two bars of 16% height separated by a 13% gap, then a stem
    down to the baseline.
    """
    glyph = size * scale
    left = (size - glyph) / 2
    top = (size - glyph) / 2

    bar = glyph * 0.16
    gap = glyph * 0.13
    stem = glyph * 0.16

    return [
        (left, top, left + glyph, top + bar),
        (left, top + bar + gap, left + glyph, top + 2 * bar + gap),
        (
            left + (glyph - stem) / 2,
            top + 2 * bar + gap,
            left + (glyph + stem) / 2,
            top + glyph,
        ),
    ]


def coverage(x, y, rects):
    """Fraction of the pixel at (x, y) covered by any rectangle."""
    hits = 0
    step = 1.0 / SUPERSAMPLE
    for sy in range(SUPERSAMPLE):
        py = y + (sy + 0.5) * step
        for sx in range(SUPERSAMPLE):
            px = x + (sx + 0.5) * step
            for x0, y0, x1, y1 in rects:
                if x0 <= px < x1 and y0 <= py < y1:
                    hits += 1
                    break
    return hits / (SUPERSAMPLE * SUPERSAMPLE)


def render(size, background, glyph_colour, scale):
    """background=None renders a transparent canvas (adaptive foreground)."""
    rects = tenge_rects(size, scale)
    pixels = bytearray(size * size * 4)

    for y in range(size):
        row = y * size * 4
        for x in range(size):
            alpha = coverage(x, y, rects)
            index = row + x * 4

            if background is None:
                pixels[index] = glyph_colour[0]
                pixels[index + 1] = glyph_colour[1]
                pixels[index + 2] = glyph_colour[2]
                pixels[index + 3] = int(round(alpha * 255))
            else:
                for channel in range(3):
                    blended = (
                        background[channel] * (1 - alpha)
                        + glyph_colour[channel] * alpha
                    )
                    pixels[index + channel] = int(round(blended))
                pixels[index + 3] = 255

    return pixels


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, os.pardir, 'assets', 'icon')
    os.makedirs(out, exist_ok=True)

    # Full icon: iOS and the legacy Android launcher mask it themselves.
    write_png(os.path.join(out, 'icon.png'), SIZE, SIZE,
              render(SIZE, TEAL, WHITE, 0.52))

    # Adaptive background: flat brand colour.
    flat = bytearray()
    for _ in range(SIZE * SIZE):
        flat.extend(bytes(TEAL) + b'\xff')
    write_png(os.path.join(out, 'icon_bg.png'), SIZE, SIZE, flat)

    # Adaptive foreground: glyph on transparency. It is drawn at 42% of the
    # canvas so it stays inside the 66% safe zone even with inset 0.
    write_png(os.path.join(out, 'icon_foreground.png'), SIZE, SIZE,
              render(SIZE, None, WHITE, 0.42))

    print('wrote icon.png, icon_bg.png, icon_foreground.png to', out)


if __name__ == '__main__':
    main()
