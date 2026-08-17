"""Generate the system-tray icons from build/icon.png.

Run manually after the app icon changes:

    python tools/make-tray-icons.py

Outputs (committed to the repo, shipped via electron-builder `extraResources`):

    resources/tray/tray.png            16x16 colour   - Windows / Linux
    resources/tray/tray@2x.png         32x32 colour     (Electron picks @2x on HiDPI)
    resources/tray/trayTemplate.png    16x16 template - macOS (black + alpha only)
    resources/tray/trayTemplate@2x.png 32x32 template

Why not just downscale the app icon: it is a dark rounded square, which
disappears into a dark Windows taskbar. The dark plate is dropped so only the
blue speech bubble with its waveform survives, which reads on both light and
dark backgrounds. The macOS template variant is the same silhouette painted
black with the waveform bars punched out, because macOS recolours template
images itself and only looks at the alpha channel.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon.png"
OUT_DIR = ROOT / "resources" / "tray"

# the rounded plate behind the bubble; anything this dark is background
PLATE_MAX_CHANNEL = 70
# the waveform bars inside the bubble; punched out of the macOS template
BAR_MIN_CHANNEL = 200
SIZES = {"": 16, "@2x": 32}


def load_content(path: Path) -> Image.Image:
    """The app icon with its dark plate removed and cropped to the artwork."""
    icon = Image.open(path).convert("RGBA")
    pixels = icon.load()
    width, height = icon.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a and max(r, g, b) < PLATE_MAX_CHANNEL:
                pixels[x, y] = (r, g, b, 0)
    box = icon.getbbox()
    return icon.crop(box) if box else icon


def to_template(content: Image.Image) -> Image.Image:
    """Black silhouette with the light waveform bars punched out."""
    template = Image.new("RGBA", content.size, (0, 0, 0, 0))
    src = content.load()
    dst = template.load()
    width, height = content.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = src[x, y]
            if not a:
                continue
            if min(r, g, b) >= BAR_MIN_CHANNEL:
                continue  # a waveform bar: leave it transparent
            dst[x, y] = (0, 0, 0, a)
    return template


def save_scaled(image: Image.Image, stem: str) -> None:
    for suffix, size in SIZES.items():
        canvas = Image.new("RGBA", (max(image.size),) * 2, (0, 0, 0, 0))
        canvas.paste(image, ((canvas.width - image.width) // 2, (canvas.height - image.height) // 2))
        out = canvas.resize((size, size), Image.LANCZOS)
        path = OUT_DIR / f"{stem}{suffix}.png"
        out.save(path)
        print(f"wrote {path.relative_to(ROOT)} ({size}x{size})")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    content = load_content(SOURCE)
    save_scaled(content, "tray")
    save_scaled(to_template(content), "trayTemplate")


if __name__ == "__main__":
    main()
