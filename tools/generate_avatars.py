#!/usr/bin/env python3
import argparse
import json
import os

PALETTES = [
    ("#ff8a5b", "#d63d5e"), ("#4fd1c5", "#1f7a8c"), ("#8f7bff", "#4c3fd6"),
    ("#ffd166", "#e08a1e"), ("#6ee7b7", "#159f6d"), ("#7dd3fc", "#1d6fb8"),
    ("#f9a8d4", "#be3d7c"), ("#c4b5fd", "#6d4bd8"), ("#fdba74", "#c2410c"),
    ("#a7f3d0", "#0f766e"), ("#93c5fd", "#1e40af"), ("#fca5a5", "#b91c1c"),
    ("#d9f99d", "#4d7c0f"), ("#bae6fd", "#0369a1")
]

MARKS = [
    '<circle cx="48" cy="48" r="17" fill="#fff" opacity=".92"/>',
    '<path d="M48 24 70 66H26z" fill="#fff" opacity=".92"/>',
    '<rect x="30" y="30" width="36" height="36" rx="8" fill="#fff" opacity=".92"/>',
    '<path d="M48 22 74 48 48 74 22 48z" fill="#fff" opacity=".92"/>',
    '<path d="M24 60c8-16 16 16 24 0s16 16 24 0" stroke="#fff" stroke-width="9" fill="none" opacity=".92" stroke-linecap="round"/>',
    '<circle cx="48" cy="48" r="20" fill="none" stroke="#fff" stroke-width="9" opacity=".92"/>',
    '<path d="M48 22c14 10 20 26 0 52-20-26-14-42 0-52z" fill="#fff" opacity=".92"/>',
    '<path d="M26 62V34l22 14 22-14v28z" fill="#fff" opacity=".92"/>',
    '<circle cx="36" cy="42" r="10" fill="#fff" opacity=".92"/><circle cx="60" cy="58" r="14" fill="#fff" opacity=".62"/>',
    '<path d="M24 48h48M48 24v48" stroke="#fff" stroke-width="9" opacity=".92" stroke-linecap="round"/>',
    '<path d="M48 20 62 44H34z" fill="#fff" opacity=".92"/><circle cx="48" cy="62" r="11" fill="#fff" opacity=".72"/>',
    '<path d="M28 28h40v40H28z" fill="none" stroke="#fff" stroke-width="9" opacity=".92"/>',
    '<path d="M30 66c0-20 10-34 18-40 8 6 18 20 18 40z" fill="#fff" opacity=".92"/>',
    '<path d="M26 52c10-14 34-14 44 0-10 14-34 14-44 0z" fill="#fff" opacity=".92"/>'
]


def avatar_svg(index, palette, mark):
    c1, c2 = palette
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">'
        f'<defs><linearGradient id="g{index}" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>'
        "</linearGradient></defs>"
        f'<rect width="96" height="96" rx="26" fill="url(#g{index})"/>'
        '<ellipse cx="34" cy="24" rx="26" ry="16" fill="#fff" opacity=".16"/>'
        f"{mark}</svg>"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="client/assets/avatars")
    parser.add_argument("--sheet", default="docs/preview-avatars.png")
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(os.path.dirname(args.sheet) or ".", exist_ok=True)

    names = []
    for i, (palette, mark) in enumerate(zip(PALETTES, MARKS), start=1):
        name = f"a{i:02d}.svg"
        names.append(name)
        with open(os.path.join(args.out, name), "w", encoding="utf-8") as fh:
            fh.write(avatar_svg(i, palette, mark))

    with open(os.path.join(args.out, "fallback.svg"), "w", encoding="utf-8") as fh:
        fh.write(avatar_svg(0, ("#9aa4b2", "#5b6472"),
                            '<circle cx="48" cy="38" r="13" fill="#fff" opacity=".9"/>'
                            '<path d="M22 78c4-16 13-22 26-22s22 6 26 22z" fill="#fff" opacity=".9"/>'))

    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"avatars": names, "fallback": "fallback.svg"}, fh, indent=2)

    print(json.dumps({"avatars": len(names), "dir": args.out}))


if __name__ == "__main__":
    main()
