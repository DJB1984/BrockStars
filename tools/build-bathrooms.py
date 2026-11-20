"""Author Brock 3's mirrored bathrooms from the November 2026 reference photos.

Writes editable Pixel Forge grids; render/export with the Pixel Forge CLI.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PALETTE = {
    'k': 'outline', 'w': 'white', 'h': 'light_gray', 'l': 'gray',
    'm': 'slate', 'd': 'dark_slate', 'n': 'night',
    'c': '#e6e2cf', 's': '#b9b7a8', 'g': '#646862', 'f': '#777b73',
}


class Grid:
    def __init__(self, w, h):
        self.rows = [list('.' * w) for _ in range(h)]

    def rect(self, x, y, w, h, color):
        for row in self.rows[y:y+h]:
            row[x:x+w] = color * w

    def paste(self, rows, x, y):
        for dy, row in enumerate(rows):
            for dx, color in enumerate(row):
                if color != '.':
                    self.rows[y+dy][x+dx] = color

    def text(self):
        return '\n'.join(''.join(row) for row in self.rows) + '\n'


def save_prop(name, size, footprint, frames):
    folder = ROOT / 'sprites' / name
    (folder / 'frames').mkdir(parents=True, exist_ok=True)
    spec = dict(name=name, type='prop', view='topdown', size=size,
                origin=[size[0] // 2, size[1]], footprint=footprint,
                palette=PALETTE,
                animations={state: {'frames': [state]} for state in frames})
    (folder / 'sprite.json').write_text(json.dumps(spec, indent=1) + '\n')
    for state, grid in frames.items():
        (folder / 'frames' / (state + '.txt')).write_text(grid.text())


def shower(south=False):
    g = Grid(48, 40)
    g.rect(0, 0, 48, 40, 'k')
    g.rect(1, 1, 46, 38, 'g')
    # Small mosaic floor and drain, with dark tiled partitions.
    for y in range(12, 38, 6):
        g.rect(4, y, 40, 1, 'f')
    for x in range(4, 45, 6):
        g.rect(x, 12, 1, 26, 'f')
    g.rect(22, 28, 5, 4, 'n')
    g.rect(23, 29, 3, 1, 'l')
    g.rect(1, 1, 46, 9, 'd')
    g.rect(2, 2, 44, 1, 'l')
    for x in (15, 31):
        g.rect(x, 3, 1, 7, 'm')
    g.rect(1, 10, 3, 29, 'd')
    g.rect(44, 10, 3, 29, 'n')
    g.rect(1, 10, 1, 28, 'l')
    # Chrome shower head and control on the back wall.
    g.rect(23, 4, 2, 7, 'h')
    g.rect(21, 9, 6, 2, 'w')
    g.rect(23, 15, 3, 2, 'h')
    # Pulled-back white curtain leaves the shower floor visible.
    cy = 11 if south else 23
    g.rect(3, cy, 42, 2, 'l')
    g.rect(4, cy, 40, 1, 'w')
    for x in (5, 8, 11, 14):
        g.rect(x, cy-1, 1, 3, 'h')
    g.rect(5, cy+2, 12, 12, 'h')
    for x in (6, 10, 14):
        g.rect(x, cy+2, 2, 11, 'w')
    # Cut away the near edge for a readable north-facing stall.
    if south:
        g.rect(4, 0, 40, 10, '.')
        g.rect(4, 36, 40, 4, 'd')
        g.rect(4, 36, 40, 1, 'l')
        g.rect(23, 33, 3, 2, 'h')
    else:
        g.rect(4, 38, 40, 2, 'l')
    # Compress the floor depth to leave a full character-height central aisle.
    del g.rows[18:26]
    return g


def toilet_stall(south=False):
    g = Grid(40, 40)
    g.rect(1, 1, 38, 38, 'g')
    toilet = (ROOT / 'sprites/toilet/frames/toilet.txt').read_text().splitlines()
    if south:
        toilet = toilet[::-1]
    g.paste(toilet, 4, 4)
    for x in (0, 37):
        g.rect(x, 0, 3, 40, 'k')
        g.rect(x+1, 1, 1, 37, 'c')
    # Cream partition doors, open toward the aisle, silver posts/hinges.
    y = 0 if south else 29
    g.rect(2, y, 36, 2, 'l')
    g.rect(3, y, 34, 1, 'h')
    g.rect(4, y+2, 12, 8, 's')
    g.rect(4, y+2, 11, 7, 'c')
    g.rect(13, y+5, 2, 1, 'k')
    g.rect(1, y+3, 2, 3, 'h')
    g.rect(37, y+3, 2, 3, 'h')
    return g


def urinal(south=False):
    g = Grid(20, 28)
    g.rect(1, 1, 2, 25, 's')
    g.rect(1, 1, 1, 24, 'c')
    g.rect(9, 1, 3, 7, 'l')
    g.rect(7, 3, 9, 2, 'h')
    g.rect(5, 8, 13, 16, 'k')
    g.rect(6, 8, 11, 15, 'w')
    g.rect(8, 12, 7, 8, 'h')
    g.rect(9, 13, 5, 6, 'l')
    g.rect(8, 21, 8, 3, 'h')
    g.rect(9, 24, 6, 1, 'k')
    if south:
        g.rows.reverse()
    return g


def sink(south=False):
    g = Grid(32, 32)
    g.rect(0, 0, 32, 28, 'k')
    g.rect(1, 1, 30, 26, 'w')
    g.rect(2, 24, 28, 3, 'h')
    g.rect(6, 8, 20, 13, 'h')
    g.rect(8, 9, 16, 10, 'l')
    g.rect(10, 10, 12, 7, 'h')
    g.rect(15, 14, 2, 2, 'm')
    fy = 22 if south else 3
    g.rect(14, fy, 4, 5, 'l')
    g.rect(14, fy, 2, 4, 'w')
    g.rect(10, fy+1, 3, 2, 'h')
    g.rect(19, fy+1, 3, 2, 'h')
    g.rect(2, 28, 3, 4, 'm')
    g.rect(27, 28, 3, 4, 'd')
    return g


def compact_stall(south=False):
    g = Grid(32, 36)
    g.rect(0, 0, 32, 36, 'g')
    toilet = (ROOT / 'sprites/toilet/frames/toilet.txt').read_text().splitlines()
    if south:
        toilet.reverse()
    g.paste([row[6:26] for row in toilet], 6, 0)
    for x in (0, 30):
        g.rect(x, 0, 2, 36, 'k')
        g.rect(x, 1, 1, 33, 'c')
    y = 0 if south else 28
    g.rect(1, y, 30, 2, 'h')
    g.rect(3, y+2, 10, 6, 's')
    g.rect(3, y+2, 9, 5, 'c')
    g.rect(10, y+4, 2, 1, 'k')
    return g


def compact_sink(south=True):
    g = Grid(24, 24)
    g.rect(0, 0, 24, 24, 'k')
    g.rect(1, 1, 22, 22, 'w')
    g.rect(2, 21, 21, 2, 'h')
    g.rect(4, 4, 16, 12, 'h')
    g.rect(6, 5, 12, 9, 'l')
    g.rect(7, 6, 10, 7, 'h')
    g.rect(11, 10, 2, 2, 'm')
    fy = 17 if south else 1
    if not south:
        # Basin sits forward of the faucet when the counter is on the north wall.
        g.rect(1, 1, 22, 20, 'w')
        g.rect(4, 8, 16, 12, 'h')
        g.rect(6, 9, 12, 9, 'l')
        g.rect(7, 10, 10, 7, 'h')
        g.rect(11, 14, 2, 2, 'm')
    g.rect(10, fy, 4, 5, 'l')
    g.rect(10, fy, 2, 4, 'w')
    g.rect(6, fy+1, 3, 2, 'h')
    g.rect(15, fy+1, 3, 2, 'h')
    return g


def compact_shower(south=False):
    g = shower(south)
    for row in g.rows:
        del row[36:42]
        del row[4:10]
    return g


def central_shower(south=False):
    # Wider cubicles reused by the two wall-backed banks.
    g = shower(south)
    for row in g.rows:
        del row[40:44]
        del row[4:8]
    return g


def main():
    save_prop('shower_stall', [48, 32], [0, 0, 48, 32],
              {'north': shower(), 'south': shower(True)})
    save_prop('toilet_stall', [40, 40], [0, 0, 40, 36],
              {'north': toilet_stall(), 'south': toilet_stall(True)})
    save_prop('urinal', [20, 28], [0, 0, 20, 24],
              {'north': urinal(), 'south': urinal(True)})
    save_prop('bathroom_sink', [32, 32], [0, 0, 32, 28],
              {'north': sink(), 'south': sink(True)})
    save_prop('toilet_stall_compact', [32, 36], [0, 0, 32, 34],
              {'north': compact_stall(), 'south': compact_stall(True)})
    save_prop('bathroom_sink_compact', [24, 24], [0, 0, 24, 24],
              {'south': compact_sink(), 'north': compact_sink(False)})
    save_prop('shower_stall_compact', [36, 32], [0, 0, 36, 32],
              {'north': compact_shower(), 'south': compact_shower(True)})
    save_prop('shower_stall_central', [40, 32], [0, 0, 40, 32],
              {'north': central_shower(), 'south': central_shower(True)})
    # Append the grey bathroom floor without renumbering existing tiles.
    folder = ROOT / 'sprites/dorm'
    p = folder / 'sprite.json'
    tileset = json.loads(p.read_text())
    tileset['palette'].update({'v': '#646862', 'z': '#74786f'})
    floor = Grid(16, 16)
    for y in range(16):
        for x in range(16):
            floor.rows[y][x] = 'z' if x == 15 or y == 15 else 'v'
    (folder / 'frames/bathroom_floor.txt').write_text(floor.text())
    if 'bathroom_floor' not in tileset['tiles']:
        tileset['tiles'].append('bathroom_floor')
    p.write_text(json.dumps(tileset, indent=1) + '\n')
    p = ROOT / 'levels/brock3.json'
    level = json.loads(p.read_text())
    level['legend']['b'] = 'bathroom_floor'
    ground, decor = level['layers'][:2]
    # Replace the obsolete internal walls; preserve the stairwell and perimeter.
    for y in range(23, 34):
        row = list(ground['rows'][y])
        row[40:67] = 'b' * 27
        row[89:113] = 'b' * 24
        ground['rows'][y] = ''.join(row)
    for y, columns in ((21, [47, 60, 95, 103]), (34, [50, 54, 58, 94, 98, 102])):
        row = list(ground['rows'][y])
        for x in columns:
            row[x] = 'B'
        ground['rows'][y] = ''.join(row)
    row = list(ground['rows'][22])
    for x in (47, 60, 95, 103):
        row[x] = 'F'
    ground['rows'][22] = ''.join(row)
    for y in (34, 35):
        row = list(decor['rows'][y])
        row[39:73] = '.' * 34
        row[89:114] = '.' * 25
        decor['rows'][y] = ''.join(row)
    fixtures = {'sink', 'toilet', 'shower_stall', 'toilet_stall', 'urinal', 'bathroom_sink',
                'toilet_stall_compact', 'bathroom_sink_compact', 'shower_stall_compact',
                'shower_stall_central'}
    objects = level['objects']['list']
    objects[:] = [o for o in objects if o.get('prop') not in fixtures]
    east = []
    def add(prop, x, y, state):
        east.append(dict(prop=prop, at=[x, y], state=state))
    # Critique 25: north wall, from the stairwell eastward: two toilet stalls,
    # two urinals, then the entrance. Four sinks occupy the south wall.
    for x in (1440, 1472):
        add('toilet_stall_compact', x, 404, 'north')
    for x in (1498, 1518):
        add('urinal', x, 400, 'north')
    for x in (1436, 1460, 1484, 1508):
        add('bathroom_sink_compact', x, 544, 'south')
    # Critique 27: rotate the approved left section into the right section,
    # drawing each fixture for its new north/south perspective.
    for x in (1792, 1760):
        add('toilet_stall_compact', x, 544, 'south')
    for x in (1734, 1714):
        add('urinal', x, 540, 'south')
    for x in (1796, 1772, 1748, 1724):
        add('bathroom_sink_compact', x, 392, 'north')
    for x in (1572, 1612, 1652):
        add('shower_stall_central', x, 400, 'north')
    for x in (1532, 1572, 1612):
        add('shower_stall_central', x, 544, 'south')
    for o in east[:8]:
        o['at'][0] -= 48
    objects.extend(east)
    # Entrances stay in the west/east halves, clear of the wall fixtures.
    for y, old_start, new_start, face in ((21, 88, 98, 'B'), (22, 88, 98, 'F'),
                                         (34, 104, 107, 'B'), (35, 104, 107, 'F')):
        row = list(ground['rows'][y])
        row[old_start:old_start+5] = face * 5
        if y == 21:
            row[88] = 'j'  # stairwell wall still joins the north wall
        if y == 22:
            row[88] = 'I'
        row[new_start:new_start+5] = 'JbbbK' if face == 'B' else 'MbbbN'
        ground['rows'][y] = ''.join(row)
    # Critique 26: tighten the north fixtures and shift the doorway west.
    for y, face, jambs in ((21, 'B', 'JbbbK'), (22, 'F', 'MbbbN')):
        row = list(ground['rows'][y])
        row[89:113] = face * 24
        row[95:100] = jambs
        ground['rows'][y] = ''.join(row)
    # Backward-L privacy screen: right leg descends from the door's east jamb;
    # its return reaches west across the view into the showers. Exit to the left.
    for y in range(23, 24):
        row = list(ground['rows'][y])
        row[99] = 'I'
        ground['rows'][y] = ''.join(row)
    for y, tiles in ((24, 'KR'), (25, 'NM')):
        row = list(ground['rows'][y])
        row[98:100] = tiles
        ground['rows'][y] = ''.join(row)
    # South doorway and privacy screen are the rotated counterpart of the north.
    for y, face, jambs in ((34, 'B', 'JbbbK'), (35, 'F', 'MbbbN')):
        row = list(ground['rows'][y])
        row[89:113] = face * 24
        row[102] = 'T' if face == 'B' else 'N'
        row[103:106] = jambs[1:4]
        row[106] = 'K' if face == 'B' else 'N'
        ground['rows'][y] = ''.join(row)
    for y in range(33, 34):
        row = list(ground['rows'][y])
        row[102] = 'I'
        ground['rows'][y] = ''.join(row)
    for y, tiles in ((31, 'KJ'), (32, 'IM')):
        row = list(ground['rows'][y])
        row[102:104] = tiles
        ground['rows'][y] = ''.join(row)
    # Critique 29: take exactly three columns from the stair room, preserving
    # its left-side access and a three-tile stair flight inside the smaller room.
    for y in range(21, 36):
        row = list(ground['rows'][y])
        row[85] = 'j' if y == 21 else ('L' if y == 34 else ('F' if y == 35 else 'I'))
        if y == 21:
            row[88] = 'B'
        elif y == 22:
            row[88] = 'F'
        elif y == 34:
            row[86:89] = 'BBB'
        elif y == 35:
            row[86:89] = 'FFF'
        else:
            row[82:85] = 'SSS'
            row[86:89] = 'bbb'
        ground['rows'][y] = ''.join(row)
    # Shift the north entrance and its compact privacy wall with the left zone.
    for y, face, jambs in ((21, 'B', 'JbbbK'), (22, 'F', 'MbbbN')):
        row = list(ground['rows'][y])
        row[89:113] = face * 24
        row[92:97] = jambs
        ground['rows'][y] = ''.join(row)
    for y, old_start, new_start, tiles in ((23, 99, 96, 'I'),
                                          (24, 98, 95, 'KR'), (25, 98, 95, 'NM')):
        row = list(ground['rows'][y])
        row[old_start:old_start+len(tiles)] = 'b' * len(tiles)
        row[new_start:new_start+len(tiles)] = tiles
        ground['rows'][y] = ''.join(row)
    # Short dividers separate each sink counter from the central shower bank.
    # Critique 31: move each divider one tile toward the sinks to fit a third stall.
    for y, x, tile in ((21, 105, 'j'), (22, 105, 'I'), (23, 105, 'I'),
                        (24, 105, 'O'), (25, 105, 'P'), (31, 93, 'Q'),
                        (32, 93, 'I'), (33, 93, 'I'), (34, 93, 'L'), (35, 93, 'F')):
        row = list(ground['rows'][y])
        row[x] = tile
        ground['rows'][y] = ''.join(row)
    # Critique 32: reflect the finished east interior into the equally wide west
    # bathroom. Keep its existing thick east boundary and the surrounding rooms.
    mirror = str.maketrans(dict(zip('ADEHJKMNRTklmnpqUVWXYZ',
                                     'DAHEKJNMTRlknmqpWVUZYX')))
    for layer in (ground, decor):
        for y in range(21, 36):
            row = list(layer['rows'][y])
            row[39:67] = layer['rows'][y][86:114][::-1].translate(mirror)
            layer['rows'][y] = ''.join(row)
    objects.extend(dict(o, at=[2448-o['at'][0], o['at'][1]]) for o in east)
    p.write_text(json.dumps(level, indent=1) + '\n')


if __name__ == '__main__':
    main()
