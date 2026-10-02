#!/usr/bin/env python3
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_pieces as gp

LIGHT = (234, 223, 200)
DARK = (169, 122, 82)
BORDER = (58, 42, 30)
CELL = 130
SIZE = CELL * 8

START = [
    "rnbqkbnr",
    "pppppppp",
    "........",
    "........",
    "........",
    "........",
    "PPPPPPPP",
    "RNBQKBNR"
]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "docs/preview-game.png"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    board = Image.new("RGBA", (SIZE, SIZE), LIGHT)
    draw = ImageDraw.Draw(board)
    for r in range(8):
        for f in range(8):
            if (r + f) % 2 == 1:
                draw.rectangle([f * CELL, r * CELL, (f + 1) * CELL, (r + 1) * CELL], fill=DARK)

    cache = {}
    for r, row in enumerate(START):
        for f, ch in enumerate(row):
            if ch == ".":
                continue
            key = ch.lower()
            color = "w" if ch.isupper() else "b"
            if key not in cache:
                fill, edge = (gp.WHITE_FILL, gp.WHITE_EDGE) if color == "w" else (gp.BLACK_FILL, gp.BLACK_EDGE)
                cache[key] = gp.render_png(key, fill, edge).resize((CELL, CELL), Image.LANCZOS)
            board.alpha_composite(cache[key], (f * CELL, r * CELL))

    frame = Image.new("RGBA", (SIZE + 48, SIZE + 48), BORDER)
    frame.alpha_composite(board, (24, 24))
    frame.convert("RGB").save(out, quality=94)
    print(out)


if __name__ == "__main__":
    main()
