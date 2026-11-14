"""Export Mason's editable pixelforge grids (Pillow; no pixelforge CLI required)."""
import json
import base64
from fnmatch import fnmatchcase
from math import ceil
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'sprites/mason'


def render(entry, palette, role=None, roles=None):
    canvas = Image.new('RGBA', (64, 64))
    if isinstance(entry, str):
        assigned = 'hurt'
        for pattern, value in (roles or {}).items():
            if fnmatchcase(entry, pattern):
                assigned = value
        if role is not None and assigned != role:
            return canvas
        rows = (SOURCE / 'frames' / f'{entry}.txt').read_text().splitlines()
        assert len(rows) == 64 and all(len(row) == 64 for row in rows), entry
        for y, row in enumerate(rows):
            for x, char in enumerate(row):
                if char != '.':
                    canvas.putpixel((x, y), palette[char])
        return canvas
    if 'from' in entry:
        canvas = render(entry['from'], palette, role, roles)
    for layer in entry.get('layers', []):
        canvas.alpha_composite(render(layer, palette, role, roles))
    if entry.get('flip') == 'h':
        canvas = canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if 'offset' in entry:
        shifted = Image.new('RGBA', canvas.size)
        shifted.paste(canvas, tuple(entry['offset']))
        canvas = shifted
    return canvas


def main():
    spec = json.loads((SOURCE / 'sprite.json').read_text())
    shared = json.loads((ROOT / 'palettes/game.json').read_text())['colors']
    from PIL.ImageColor import getcolor
    palette = {k: getcolor(shared.get(v, v), 'RGBA') for k, v in spec['palette'].items()}
    count = sum(len(a['frames']) for a in spec['animations'].values())
    sheet = Image.new('RGBA', (259, ceil(count / 4) * 65 - 1))
    frames, tags, animations, images = {}, [], {}, []
    for action, animation in spec['animations'].items():
        start = len(frames)
        for entry in animation['frames']:
            index = len(frames)
            image = render(entry, palette)
            boxes = {}
            for role in ('hurt', 'hit'):
                bounds = render(entry, palette, role, spec.get('roles')).getbbox()
                if bounds:
                    pad = spec.get(f'{role}_pad', 0)
                    left, top = max(0, bounds[0]-pad), max(0, bounds[1]-pad)
                    right, bottom = min(64, bounds[2]+pad), min(64, bounds[3]+pad)
                    boxes[role] = [[left, top, right-left, bottom-top]]
                else:
                    boxes[role] = []
            images.append(image)
            x, y = (index % 4) * 65, (index // 4) * 65
            sheet.paste(image, (x, y))
            frames[str(index)] = {
                'frame': {'x': x, 'y': y, 'w': 64, 'h': 64},
                'rotated': False, 'trimmed': False,
                'spriteSourceSize': {'x': 0, 'y': 0, 'w': 64, 'h': 64},
                'sourceSize': {'w': 64, 'h': 64}, 'pivot': {'x': .5, 'y': .8125},
                'duration': entry.get('duration', round(1000 / animation.get('fps', 8))),
                'pixelforge': boxes,
            }
        key = f'mason_{action}'
        tags.append({'name': key, 'from': start, 'to': len(frames)-1, 'direction': 'forward', 'color': '#000000ff'})
        animations[key] = {'anim': action, 'loop': animation.get('loop', True), 'fps': animation.get('fps', 8), 'frames': len(frames)-start}
    metadata = {'app': 'pixelforge', 'version': '1.0', 'image': 'mason.png', 'format': 'RGBA8888',
                'size': {'w': sheet.width, 'h': sheet.height}, 'scale': '1', 'frameTags': tags, 'layers': [], 'slices': [],
                'pixelforge': {'sprite': 'mason', 'kind': 'sprite', 'view': 'topdown', 'class': 'topdown',
                               'origin': [32, 52], 'anchor': 'feet', 'body': {'x': 20, 'y': 6, 'w': 24, 'h': 46},
                               'animations': animations}}
    sheet.save(ROOT / 'export/mason.png')
    (ROOT / 'export/mason.json').write_text(json.dumps({'frames': frames, 'meta': metadata}, indent=2) + '\n')
    gallery_path = ROOT / 'export/gallery.html'
    if gallery_path.exists():
        html = gallery_path.read_text(encoding='utf-8')
        before, rest = html.split('const DATA = ', 1)
        raw, after = rest.split(';\n', 1)
        gallery = json.loads(raw)
        entry = {'name': 'mason', 'kind': 'sprite', 'w': 64, 'h': 64,
                 'origin': [32, 52], 'body': [20, 6, 24, 46], 'class': 'topdown',
                 'palette': [[key, value, spec['palette'][key]] for key, value in
                             ((k, shared.get(v, v)) for k, v in spec['palette'].items())],
                 'sheet': 'data:image/png;base64,' + base64.b64encode((ROOT / 'export/mason.png').read_bytes()).decode(),
                 'anims': []}
        for tag in tags:
            action = animations[tag['name']]
            entry['anims'].append({'name': action['anim'], 'loop': action['loop'], 'fps': action['fps'],
                'frames': [{'x': frames[str(i)]['frame']['x'], 'y': frames[str(i)]['frame']['y'],
                            'd': frames[str(i)]['duration'], **frames[str(i)]['pixelforge']}
                           for i in range(tag['from'], tag['to'] + 1)]})
        gallery['sprites'] = [s for s in gallery['sprites'] if s['name'] != 'mason'] + [entry]
        gallery_path.write_text(before + 'const DATA = ' + json.dumps(gallery, separators=(',', ':')) + ';\n' + after,
                                encoding='utf-8')
    preview = ROOT / 'previews'
    preview.mkdir(exist_ok=True)
    board = Image.new('RGBA', (384, 192), '#d5d9df')
    for i, index in enumerate([0, 6, 12]):
        board.alpha_composite(images[index].resize((128, 128), Image.Resampling.NEAREST), (i*128, 0))
    draw = ImageDraw.Draw(board)
    for i, label in enumerate(['FRONT', 'BACK', 'SIDE']):
        draw.text((i*128+42, 142), label, fill='#181425')
    board.save(preview / 'mason-directions.png')
    for start, end, name in [(2, 6, 'down'), (8, 12, 'up'), (14, 18, 'side')]:
        sequence = []
        for image in images[start:end]:
            bg = Image.new('RGBA', (64, 64), '#d5d9df')
            bg.alpha_composite(image)
            sequence.append(bg.resize((256, 256), Image.Resampling.NEAREST).convert('RGB'))
        sequence[0].save(preview / f'mason-walk-{name}.gif', save_all=True, append_images=sequence[1:], duration=100, loop=0)
    print(f'Exported Mason: {len(frames)} frames, {len(animations)} animations; previews/mason-directions.png')


if __name__ == '__main__':
    main()
