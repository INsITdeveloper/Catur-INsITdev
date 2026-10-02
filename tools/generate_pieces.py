#!/usr/bin/env python3
import argparse
import json
import math
import os

from PIL import Image, ImageDraw

SS = 4
SIZE = 100
OUT = 260

WHITE_FILL = "#f6f2e8"
WHITE_EDGE = "#26241f"
BLACK_FILL = "#31343d"
BLACK_EDGE = "#12141a"

STROKE = 2.5


def line(p0, p1, n=10):
    return [(p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n) for i in range(n + 1)]


def cubic(p0, c1, c2, p1, n=20):
    out = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p1[0]
        y = mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p1[1]
        out.append((x, y))
    return out


def arcp(cx, cy, r, a0, a1, n=26):
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        out.append((cx + r * math.sin(a), cy - r * math.cos(a)))
    return out


def chain(*parts):
    out = []
    for part in parts:
        if out and part and abs(out[-1][0] - part[0][0]) < 1e-9 and abs(out[-1][1] - part[0][1]) < 1e-9:
            out.extend(part[1:])
        else:
            out.extend(part)
    return out


def sym(profile):
    out = list(profile)
    for x, y in reversed(profile[1:-1]):
        out.append((SIZE - x, y))
    return out


def rect_profile(x0, y0, x1, y1):
    return [(50, y0), (x1, y0), (x1, y1), (50, y1)] if x1 > 50 else [(50, y0), (x1, y0), (x1, y1), (50, y1)]


PEDESTAL = sym([(50, 79), (62, 79), (67, 82.5), (74, 86), (50, 86)])
SLAB = sym([(50, 86), (76, 86), (78.5, 89.5), (78.5, 92.5), (76, 95), (50, 95)])

PAWN = [
    ("p", arcp(50, 33, 12.5, 0, 168)),
    ("p", sym(chain(
        [(50, 45)], [(58, 45)], [(59, 51)], [(54.5, 56)],
        cubic((54.5, 56), (56, 64), (58, 70), (60, 75)),
        [(61.5, 79)], [(50, 79)]
    ))),
    ("p", PEDESTAL),
    ("p", SLAB)
]

ROOK = [
    ("p", sym(chain(
        [(50, 16)], [(55, 16)], [(55, 23)], [(62, 23)], [(62, 16)], [(71, 16)],
        [(71, 29)], [(66, 33)], [(66, 39)], [(50, 39)]
    ))),
    ("p", sym(chain([(50, 39)], [(64, 39)], cubic((64, 39), (61, 52), (60.5, 66), (61, 79)), [(50, 79)]))),
    ("p", PEDESTAL),
    ("p", SLAB)
]

BISHOP = [
    ("p", sym(chain(
        [(50, 9)], [(56, 16)], [(60, 25)], [(59.5, 33)], [(55, 39)], [(50, 43)]
    ))),
    ("p", sym(chain([(50, 41)], [(59, 43.5)], [(61, 47)], [(58.5, 50.5)], [(50, 50.5)]))),
    ("p", sym(chain(
        [(50, 50)], [(56, 52)],
        cubic((56, 52), (59, 62), (58, 71), (59.5, 79)),
        [(50, 79)]
    ))),
    ("p", PEDESTAL),
    ("p", SLAB)
]

QUEEN = [
    ("p", sym(chain(
        [(50, 6)], [(53, 13)], [(55, 8)], [(60.5, 19)], [(67, 10)],
        [(70, 22)], [(64, 30)], [(63.5, 34)], [(50, 34)]
    ))),
    ("p", sym(chain([(50, 31.5)], [(64, 31.5)], [(66.5, 36.5)], [(64, 41)], [(50, 41)]))),
    ("p", sym(chain(
        [(50, 41)], [(57.5, 43)],
        cubic((57.5, 43), (62, 56), (60, 68), (61, 79)),
        [(50, 79)]
    ))),
    ("p", PEDESTAL),
    ("p", SLAB)
]

KING = [
    ("p", sym(chain(
        [(50, 4)], [(54.5, 4)], [(54.5, 10)], [(60.5, 10)], [(60.5, 14)],
        [(54.5, 14)], [(54.5, 20)], [(50, 20)]
    ))),
    ("p", sym(chain(
        [(50, 20)], [(56, 24)], [(62.5, 20.5)], [(66.5, 30)], [(63, 38)], [(62, 44)], [(50, 44)]
    ))),
    ("p", sym(chain([(50, 41.5)], [(63, 41.5)], [(65.5, 46.5)], [(62, 51)], [(50, 51)]))),
    ("p", sym(chain(
        [(50, 51)], [(57, 53)],
        cubic((57, 53), (61, 63), (59, 71), (60.5, 79)),
        [(50, 79)]
    ))),
    ("p", PEDESTAL),
    ("p", SLAB)
]

KNIGHT_NECK = [(38, 84), (72, 84), (67, 58), (60, 44), (44, 40), (38, 60)]
KNIGHT_SKULL = arcp(52, 31, 15, 0, 360, 30)
KNIGHT_SNOUT = [(46, 20), (24, 28), (12, 38), (9, 47), (16, 55), (36, 50), (46, 42)]
KNIGHT_EAR = [(52, 20), (58, 5), (65, 21)]
KNIGHT_EYE = (57, 29, 3.4)

KNIGHT = [
    ("q", KNIGHT_NECK),
    ("q", KNIGHT_SKULL),
    ("q", KNIGHT_SNOUT),
    ("q", KNIGHT_EAR),
    ("e", KNIGHT_EYE),
    ("p", PEDESTAL),
    ("p", SLAB)
]

SHAPES = {"k": KING, "q": QUEEN, "r": ROOK, "b": BISHOP, "n": KNIGHT, "p": PAWN}


def smooth(pts, tension=0.6):
    n = len(pts)
    segs = []
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension)
        segs.append((p1, c1, c2, p2))
    return segs


def to_path(segs):
    parts = ["M %.2f %.2f" % (segs[0][0][0], segs[0][0][1])]
    for _, c1, c2, p in segs:
        parts.append("C %.2f %.2f %.2f %.2f %.2f %.2f" % (c1[0], c1[1], c2[0], c2[1], p[0], p[1]))
    parts.append("Z")
    return " ".join(parts)


def sample(segs, per=24):
    pts = []
    for p1, c1, c2, p2 in segs:
        for i in range(per):
            t = i / per
            mt = 1 - t
            pts.append((
                mt ** 3 * p1[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p2[0],
                mt ** 3 * p1[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p2[1]
            ))
    return pts


def piece_paths(key, fill, edge):
    out = []
    for kind, pts in SHAPES[key]:
        if kind == "e":
            cx, cy, r = pts
            out.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{edge}"/>')
            continue
        poly = sym(pts) if kind == "p" else list(pts)
        out.append(
            f'<path d="{to_path(smooth(poly))}" fill="{fill}" stroke="{edge}" '
            f'stroke-width="{STROKE}" stroke-linejoin="round" stroke-linecap="round"/>'
        )
    return out


def build_svg(key, fill, edge):
    paths = "".join(piece_paths(key, fill, edge))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
        f"{paths}</svg>"
    )


def render_png(key, fill, edge):
    w = OUT * SS
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    width = max(2, int(STROKE / SIZE * w))
    outlines = []
    for kind, pts in SHAPES[key]:
        if kind == "e":
            continue
        poly = sym(pts) if kind == "p" else list(pts)
        poly = sample(smooth(poly))
        scaled = [(x / SIZE * w, y / SIZE * w) for x, y in poly]
        outlines.append(scaled)
        draw.polygon(scaled, fill=fill)
    for scaled in outlines:
        draw.line(scaled + [scaled[0]], fill=edge, width=width, joint="curve")
    for kind, pts in SHAPES[key]:
        if kind != "e":
            continue
        cx, cy, r = pts
        box = [(cx - r) / SIZE * w, (cy - r) / SIZE * w, (cx + r) / SIZE * w, (cy + r) / SIZE * w]
        draw.ellipse(box, fill=edge)
    return img.resize((OUT, OUT), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="client/assets/pieces")
    parser.add_argument("--sheet", default="docs/preview-pieces.png")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(os.path.dirname(args.sheet) or ".", exist_ok=True)

    index = {}
    for key in SHAPES:
        for color, fill, edge in (
            ("w", WHITE_FILL, WHITE_EDGE),
            ("b", BLACK_FILL, BLACK_EDGE)
        ):
            name = f"{color}{key}.svg"
            with open(os.path.join(args.out, name), "w", encoding="utf-8") as fh:
                fh.write(build_svg(key, fill, edge))
            index[f"{color}{key}"] = name

    order = ["k", "q", "r", "b", "n", "p"]
    sheet = Image.new("RGBA", (OUT * 6, OUT * 2), (214, 208, 196, 255))
    for col, key in enumerate(order):
        for row, (fill, edge) in enumerate(((WHITE_FILL, WHITE_EDGE), (BLACK_FILL, BLACK_EDGE))):
            sheet.alpha_composite(render_png(key, fill, edge), (col * OUT, row * OUT))
    sheet.convert("RGB").save(args.sheet, quality=92)

    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2)

    print(json.dumps({"pieces": len(index), "dir": args.out, "sheet": args.sheet}))


if __name__ == "__main__":
    main()
