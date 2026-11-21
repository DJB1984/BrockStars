import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ATTACKS, BLOCK } from '../combat/rules.js';
import { hud, touch, actions, releaseTouch, type Basic, type Facing, type HudState, type HitArrow, type NetBadge, type TouchButton } from './bridge';
import { installFrames } from './pixel';
import { Icon, type IconName } from './Icon';
import { canFullscreen, toggleFullscreen, useFullscreen } from './fullscreen';
import { LAYOUTS, keyLabel, layoutId, onLayout, setLayout } from '../controls.js';

type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];
const useLayout = (): [keyof typeof LAYOUTS, Layout] => {
  const id = useSyncExternalStore(onLayout, layoutId) as keyof typeof LAYOUTS;
  return [id, LAYOUTS[id]];
};

// The HUD over a level: the menu button (Esc) top left (Resume, Controls, Full screen on and off, Change
// fighter, Leave game), who's online top right, and at the bottom every move as a keycap (Punch, Kick,
// Headbutt, Block, the Super) that stays pushed down until the move is back. A move pressed too early
// wiggles its cap. A hit from someone you can't see flashes an arrow at the screen's edge, pointing at them.
// On touch screens the bottom becomes the controls: a Brawl Stars movement circle on the left, the five
// moves on the right, filling the same way as they come back.

type Phase = 'ready' | 'holding' | 'cooldown' | 'locked';
type Timer = { phase: Phase; endsAt: number; duration: number };
type Tone = 'ember' | 'brick' | 'amber' | 'cream' | 'pine';

const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

export function Hud() {
  const root = useRef<HTMLDivElement>(null);
  const s = useSyncExternalStore(hud.subscribe, hud.get);
  const [menu, setMenu] = useState<null | 'main' | 'controls'>(null);
  const touchMode = useTouchScreen();
  const [, keys] = useLayout();

  useEffect(() => { if (root.current) installFrames(root.current); }, []);

  useEffect(() => {
    if (!s.visible) { setMenu(null); releaseTouch(); return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setMenu((m) => (m ? null : 'main'));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [s.visible]);

  const shield = shieldTimer(s);
  const special = superTimer(s);
  const moves = { punch: moveTimer(s, 'punch'), kick: moveTimer(s, 'kick'), headbutt: moveTimer(s, 'headbutt') };
  const dodge: Timer = { phase: 'cooldown', endsAt: s.dodge.endsAt, duration: s.dodge.duration };
  const dud = (move: string) => (s.dud?.move === move ? s.dud.id : 0);
  const superDud = s.dud && !['punch', 'kick', 'headbutt', 'block'].includes(s.dud.move) ? s.dud.id : 0;

  return (
    <div ref={root} className={`hud${touchMode ? ' is-touch' : ''}`} hidden={!s.visible}>
      {s.visible && (
        <>
          <header className="hud-top">
            <button type="button" className="btn btn-pine btn-small hud-menu" onClick={() => setMenu('main')} aria-haspopup="dialog">
              <span className="btn-face"><Icon name="menu" size={3} /> Menu</span>
            </button>
            {s.net.active && <Online net={s.net} />}
          </header>

          <Toast toast={s.toast} />
          <HitArrows arrow={s.hitArrow} />

          {touchMode ? (
            <TouchControls shield={shield} special={special} moves={moves} dodge={dodge} dud={dud} superDud={superDud} superName={s.super.name} superIcon={superIcon(s)} />
          ) : (
            <div className="hud-keys">
              <MoveKey icon="punch" tone="ember" label="Punch" keyLabel={keyLabel(keys.punch)} timer={moves.punch} dud={dud('punch')} />
              <MoveKey icon="kick" tone="ember" label="Kick" keyLabel={keyLabel(keys.kick)} timer={moves.kick} dud={dud('kick')} count />
              <MoveKey icon="headbutt" tone="brick" label="Headbutt" keyLabel={keyLabel(keys.headbutt)} timer={moves.headbutt} dud={dud('headbutt')} count />
              <MoveKey icon="block" tone="cream" label="Block" keyLabel={keyLabel(keys.block)} timer={shield} dud={dud('block')} />
              <MoveKey icon={superIcon(s)} tone="amber" label={s.super.name} keyLabel={s.super.locked ? undefined : keyLabel(keys.super)} timer={special} dud={superDud} count />
              <MoveKey icon="dodge" tone="pine" label="Dodge" keyLabel={keyLabel(keys.dodge)} timer={dodge} />
            </div>
          )}

          {menu && (
            <Menu
              view={menu}
              onView={setMenu}
              onClose={() => setMenu(null)}
              superName={s.super.name}
              superLocked={s.super.locked}
              superKey={s.super.key}
              superIconName={superIcon(s)}
              touchFirst={touchMode}
            />
          )}
        </>
      )}
    </div>
  );
}

const superIcon = (s: HudState): IconName => (s.character === 'mason' ? 'grapple' : s.character === 'james' ? 'bellow' : 'takedown');

function shieldTimer(s: HudState): Timer {
  return s.shield.phase === 'ready' ? { phase: 'ready', endsAt: 0, duration: 1 } : s.shield;
}

function moveTimer(s: HudState, move: Basic): Timer {
  return { phase: 'cooldown', endsAt: s.moves[move].endsAt, duration: s.moves[move].duration };
}

function superTimer(s: HudState): Timer {
  if (s.super.locked) return { phase: 'locked', endsAt: 0, duration: 1 };
  return { phase: 'cooldown', endsAt: s.super.endsAt, duration: s.super.duration };
}

// ---- keycaps ---------------------------------------------------------------------------------------

type MoveKeyProps = {
  icon: IconName;
  tone: Tone;
  label: string;
  keyLabel?: string;
  timer?: Timer;
  count?: boolean;            // show whole seconds while it cools (the long Super cooldown)
  hold?: TouchButton;         // a touch button: holding it holds this input down
  aim?: boolean;              // ...or, for an attack, fires as the thumb lets go, the way it was dragged (useHold)
  dud?: number;               // counts up each time the move is pressed while cooling: the cap wiggles
  style?: CSSProperties;
  className?: string;
};

// A move as a chunky pixel keycap. Used, it drops onto its lip and stays down while the move cools; the
// badge's sunset rises inside it (brick, ember, amber), and it pops back up with a flash when it's ready.
// Block held up drains a cream bar instead, over the three seconds a block can last. Pressed while it's down,
// it shakes its head: a quick side-to-side wiggle (the game clicks at the same time).
// Short cooldowns (a punch's 300 ms) come back without the pop, which would flash on every mashed punch.
function MoveKey({ icon, tone, label, keyLabel, timer, count, hold, aim, dud = 0, style, className = '' }: MoveKeyProps) {
  const phase = usePhase(timer);
  const [pops, setPops] = useState(0);
  const last = useRef(phase);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === 'ready' && (last.current === 'cooldown' || last.current === 'holding') && (timer?.duration ?? 0) >= 1000) setPops((n) => n + 1);
    last.current = phase;
  }, [phase]);
  useEffect(() => {
    if (!dud) return;
    const cap = el.current?.querySelector('.mk-cap');
    cap?.animate([0, -3, 3, -2, 2, 0].map((x) => ({ translate: `${x}px 0` })), { duration: 240, easing: 'steps(6, end)' });
  }, [dud]);

  const [pressed, handlers] = useHold(hold, aim);
  const down = pressed || phase === 'cooldown' || phase === 'holding' || phase === 'locked';
  const Tag = (hold ? 'button' : 'div') as 'div';

  return (
    <Tag
      ref={el}
      {...(hold ? { type: 'button' as const, 'aria-label': label } : {})}
      {...handlers}
      className={`mk mk-${tone} is-${phase}${down ? ' is-down' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <span key={pops} className={`mk-cap${pops ? ' is-pop' : ''}`}>
        {timer && phase === 'cooldown' && <Fill key={`fill-${timer.endsAt}`} className="mk-fill" timer={timer} />}
        {timer && phase === 'holding' && <Fill key={`drain-${timer.endsAt}`} className="mk-drain" timer={timer} />}
        <Icon name={phase === 'locked' ? 'lock' : icon} size={hold ? 3 : 4} className="mk-icon" />
        {count && timer && phase === 'cooldown' && timer.duration >= 3000 && <Seconds key={`secs-${timer.endsAt}`} endsAt={timer.endsAt} />}
        {pops > 0 && <span className="mk-flash" aria-hidden="true" />}
      </span>
      {phase === 'locked' && <span className="mk-soon">Soon</span>}
      {keyLabel && <kbd className="key mk-key">{keyLabel}</kbd>}
    </Tag>
  );
}

// The timer's phase, re-rendered when its deadline passes.
function usePhase(timer?: Timer): Phase {
  const [, tick] = useState(0);
  const endsAt = timer?.endsAt ?? 0;
  const wait = endsAt - performance.now();
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), wait + 16);
    return () => clearTimeout(t);
  }, [endsAt, wait > 0]);
  if (!timer || timer.phase === 'ready' || timer.phase === 'locked') return timer?.phase ?? 'ready';
  return wait > 0 ? timer.phase : 'ready';
}

// A CSS animation already partway through: the delay is fixed when it mounts (keyed on the deadline), so
// later renders of the HUD never restart or skip it.
function Fill({ timer, className }: { timer: Timer; className: string }) {
  const [style] = useState(() => {
    const elapsed = Math.max(0, timer.duration - (timer.endsAt - performance.now()));
    return { '--dur': `${timer.duration}ms`, '--delay': `${-elapsed}ms` } as CSSProperties;
  });
  return <span className={className} style={style} aria-hidden="true" />;
}

function Seconds({ endsAt }: { endsAt: number }) {
  const left = () => Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
  const [n, setN] = useState(left);
  useEffect(() => {
    const t = setInterval(() => setN(left()), 100);
    return () => clearInterval(t);
  }, [endsAt]);
  return <span className="mk-count">{n}</span>;
}

// Pointer handlers that hold a touch input down. Each button captures its own finger, so a thumb on the
// movement circle and one on a move work together. A tap shorter than a frame or two is held a moment longer, so
// the game still sees the press.
// With `aim` (the attacks), as in Brawl Stars: a tap fires as the thumb lifts, at the nearest opponent; a drag
// past AIM_DRAG aims instead (touch.aim: the game draws the move's reach on the floor that way) and fires that way
// on release; dragged back to the middle, it's cancelled and lifting does nothing.
const AIM_DRAG = 22;   // css px
export const dragFacing = (dx: number, dy: number): Facing => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');

function useHold(name?: TouchButton, aim?: boolean) {
  const [pressed, setPressed] = useState(false);
  const since = useRef(0);
  const finger = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0, dragged: false });
  if (!name) return [false, {}] as const;
  const pulse = () => { touch[name] = true; setTimeout(() => { if (finger.current === null) touch[name] = false; }, 60); };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (finger.current !== e.pointerId) return;
    finger.current = null;
    setPressed(false);
    if (aim) {
      const facing = touch.aim?.move === name ? touch.aim.facing : null;
      touch.aim = null;
      if (e.type !== 'pointerup') return;   // the finger was taken away (a call, a palm): nothing fires
      if (!start.current.dragged) pulse();
      else if (facing) { touch.aimed = { move: name, facing }; pulse(); }
      return;
    }
    setTimeout(() => { if (finger.current === null) touch[name] = false; }, Math.max(0, 60 - (performance.now() - since.current)));
  };
  return [pressed, {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      if (finger.current !== null) return;
      finger.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      since.current = performance.now();
      start.current = { x: e.clientX, y: e.clientY, dragged: false };
      if (!aim) touch[name] = true;
      setPressed(true);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!aim || finger.current !== e.pointerId) return;
      const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y, far = Math.hypot(dx, dy) > AIM_DRAG;
      if (far) start.current.dragged = true;
      if (start.current.dragged) touch.aim = { move: name, facing: far ? dragFacing(dx, dy) : null };
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  }] as const;
}

// ---- touch controls --------------------------------------------------------------------------------

type TouchProps = { shield: Timer; special: Timer; moves?: Record<Basic, Timer>; dodge?: Timer; dud?: (move: string) => number; superDud?: number;
  superName: string; superIcon: IconName; demo?: boolean };

// Offsets from Punch (the right thumb's home), in button units: an arc of moves around it, each sized by how
// often it's pressed: Punch biggest, then Kick and the Super, Block, Headbutt, and the small Dodge tucked just
// up-left of Punch, one short thumb roll away. `aim`: tap to fire at the nearest, drag to aim.
const ARC: { name: TouchButton; label: string; icon?: IconName; tone: Tone; cx: number; cy: number; s: number; aim?: boolean }[] = [
  { name: 'punch', label: 'Punch', icon: 'punch', tone: 'ember', cx: 0, cy: 0, s: 1.45, aim: true },
  { name: 'dodge', label: 'Dodge', icon: 'dodge', tone: 'pine', cx: -0.95, cy: -0.85, s: 0.8 },
  { name: 'kick', label: 'Kick', icon: 'kick', tone: 'ember', cx: -1.6, cy: 0.1, s: 1.1, aim: true },
  { name: 'headbutt', label: 'Headbutt', icon: 'headbutt', tone: 'brick', cx: -1.95, cy: -1.15, s: 1, aim: true },
  { name: 'takedown', label: 'Super', tone: 'amber', cx: 0.05, cy: -1.6, s: 1.1, aim: true },
  { name: 'block', label: 'Block', icon: 'block', tone: 'cream', cx: -2.85, cy: 0.15, s: 1.05 },
];

function TouchControls({ shield, special, moves, dodge, dud = () => 0, superDud = 0, superName, superIcon, demo }: TouchProps) {
  return (
    <div className={`touch${demo ? ' is-demo' : ''}`} aria-hidden={demo || undefined}>
      <Stick demo={demo} />
      <div className="arc" role={demo ? undefined : 'group'} aria-label={demo ? undefined : 'Moves'}>
        {ARC.map((b) => {
          const timer = b.name === 'block' ? shield : b.name === 'takedown' ? special : b.name === 'dodge' ? dodge : moves?.[b.name as Basic];
          const style = { '--cx': b.cx, '--cy': b.cy, '--s': b.s } as CSSProperties;
          return (
            <MoveKey
              key={b.name}
              className="arc-key"
              style={style}
              icon={b.icon ?? superIcon}
              tone={b.tone}
              label={b.name === 'takedown' ? superName : b.label}
              timer={timer}
              count={!['punch', 'block', 'dodge'].includes(b.name)}
              dud={b.name === 'takedown' ? superDud : dud(b.name)}
              hold={demo || timer?.phase === 'locked' ? undefined : b.name}
              aim={b.aim}
            />
          );
        })}
      </div>
    </div>
  );
}

const DIRS = ['up', 'left', 'right', 'down'] as const;
// atan2 octants, clockwise from right (screen y points down), to the arrow keys they hold
const OCTANTS: (typeof DIRS[number])[][] = [['right'], ['right', 'down'], ['down'], ['down', 'left'], ['left'], ['left', 'up'], ['up'], ['up', 'right']];
const RING = 40, KNOB = 16;   // diameters in pixel-art cells (three screen pixels each)

// Brawl Stars' movement circle: a thumb anywhere on the left half drops the ring under it, and the knob
// follows the thumb inside it. Its direction, eight ways like the arrow keys, walks the fighter; a nudge
// near the middle does nothing. Let go and the ring goes back to rest bottom left, faint, as the hint.
function Stick({ demo }: { demo?: boolean }) {
  const ring = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const finger = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const hold = (dirs: readonly string[]) => { for (const d of DIRS) touch[d] = dirs.includes(d); };
  const follow = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = ring.current!, k = knob.current!;
    const travel = (r.offsetWidth - k.offsetWidth) / 2;
    let dx = e.clientX - origin.current.x, dy = e.clientY - origin.current.y;
    const len = Math.hypot(dx, dy);
    if (len > travel) { dx *= travel / len; dy *= travel / len; }
    const snap = (v: number) => Math.round(v / 3) * 3;   // the knob moves on the pixel grid
    k.style.transform = `translate(${snap(dx)}px, ${snap(dy)}px)`;
    hold(len < travel * 0.3 ? [] : OCTANTS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]);
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (finger.current !== e.pointerId) return;
    finger.current = null;
    hold([]);
    const r = ring.current!, k = knob.current!;
    r.style.left = r.style.top = '';
    k.style.transform = '';
    setActive(false);
  };

  const handlers = demo ? {} : {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (finger.current !== null) return;
      finger.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      // the ring lands under the thumb, kept whole on the screen
      const z = e.currentTarget.getBoundingClientRect(), half = ring.current!.offsetWidth / 2;
      const x = Math.min(Math.max(e.clientX - z.left, half), z.width - half);
      const y = Math.min(Math.max(e.clientY - z.top, half), z.height - half);
      origin.current = { x: z.left + x, y: z.top + y };
      ring.current!.style.left = `${x}px`;
      ring.current!.style.top = `${y}px`;
      setActive(true);
      follow(e);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => { if (finger.current === e.pointerId) follow(e); },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };

  return (
    <div className="stick-zone" {...handlers} role={demo ? undefined : 'group'} aria-label={demo ? undefined : 'Move: touch and drag'}>
      <div ref={ring} className={`stick-ring${active ? ' is-active' : ''}`} aria-hidden="true">
        <Disc d={RING} band />
        <span ref={knob} className="stick-knob"><Disc d={KNOB} /></span>
      </div>
    </div>
  );
}

// A pixel disc: an ink outline, a lit top-left and a shaded bottom-right, like the sprites. `band` makes
// it the joystick's ring: a dark see-through well inside a pine rim.
function Disc({ d, band }: { d: number; band?: boolean }) {
  const rows: { x: number; y: number; w: number; c: string; o?: number }[] = [];
  const r = d / 2;
  for (let y = 0; y < d; y++) {
    let run: { x: number; key: string; c: string; o?: number } | null = null;
    for (let x = 0; x <= d; x++) {
      let c = '', o: number | undefined;
      if (x < d) {
        const dist = Math.hypot(x + 0.5 - r, y + 0.5 - r);
        const lit = x + y < d - 1;   // the top-left half catches the light
        if (dist <= r) {
          if (dist > r - 1) c = '#12212a';
          else if (band) {
            if (dist > r - 4) c = lit ? '#304048' : '#182830';
            else if (dist > r - 5) { c = '#12212a'; o = 0.6; }
            else { c = '#12212a'; o = 0.3; }
          } else {
            const glint = Math.hypot(x + 0.5 - r * 0.62, y + 0.5 - r * 0.62) < r * 0.2;
            c = glint ? '#ffffff' : dist > r - 2.5 ? (lit ? '#f8d890' : '#c8a878') : '#e8d0a8';
          }
        }
      }
      const key = `${c}|${o ?? ''}`;
      if (run && run.key !== key) {
        if (run.c) rows.push({ x: run.x, y, w: x - run.x, c: run.c, o: run.o });
        run = null;
      }
      if (!run) run = { x, key, c, o };
    }
  }
  return (
    <svg viewBox={`0 0 ${d} ${d}`} shapeRendering="crispEdges" aria-hidden="true">
      {rows.map((k, i) => <rect key={i} x={k.x} y={k.y} width={k.w} height={1} fill={k.c} opacity={k.o} />)}
    </svg>
  );
}

// ---- top bar ---------------------------------------------------------------------------------------

function Online({ net }: { net: NetBadge }) {
  return (
    <div className="hud-online px-panel" role="status" aria-live="polite">
      <i className="online-dot" aria-hidden="true" />
      {net.world || !net.room ? (
        <span><b>{net.count}</b> online</span>
      ) : (
        <span>Room <b className="hud-code">{net.room}</b> <b>{net.count}</b> here</span>
      )}
    </div>
  );
}

// Each hit from someone off screen (or in a dark room): a red pixel arrow on the screen's edge, where the
// line from you toward them leaves the screen, pointing out at them. It blinks and fades in under a second.
function HitArrows({ arrow }: { arrow: HitArrow | null }) {
  const [shown, setShown] = useState<HitArrow[]>([]);
  useEffect(() => {
    if (!arrow) return;
    setShown((list) => [...list.slice(-3), arrow]);
    const t = setTimeout(() => setShown((list) => list.filter((a) => a.id !== arrow.id)), 900);
    return () => clearTimeout(t);
  }, [arrow?.id]);
  return (
    <>
      {shown.map((a) => {
        const w = innerWidth, h = innerHeight, inset = 34;
        const ox = a.from[0] * w, oy = a.from[1] * h, cos = Math.cos(a.angle), sin = Math.sin(a.angle);
        // Along the ray from you, to whichever edge (inset) comes first.
        const reach = Math.min(cos > 0 ? (w - inset - ox) / cos : cos < 0 ? (inset - ox) / cos : Infinity,
                               sin > 0 ? (h - inset - oy) / sin : sin < 0 ? (inset - oy) / sin : Infinity);
        const x = ox + cos * Math.max(0, reach), y = oy + sin * Math.max(0, reach);
        return (
          <span key={a.id} className="hit-arrow" style={{ left: x, top: y, transform: `translate(-50%, -50%) rotate(${a.angle}rad)` }} aria-hidden="true">
            <svg viewBox={`0 0 ${ARROW[0].length} ${ARROW.length}`} shapeRendering="crispEdges">
              {ARROW.flatMap((row, y) => [...row].map((c, x) => c === '.' ? null
                : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={c === 'k' ? '#12212a' : c === 'w' ? '#ffffff' : '#e43b44'} />))}
            </svg>
          </span>
        );
      })}
    </>
  );
}

// Pointing right (angle 0): ink outline, red inside, a lit edge on top.
const ARROW = [
  'kk.....',
  'kwk....',
  'krwk...',
  'krrrk..',
  'krrrrk.',
  'krrrrrk',
  'krrrrk.',
  'krrrk..',
  'krrk...',
  'krk....',
  'kk.....',
];

function Toast({ toast }: { toast: HudState['toast'] }) {
  const [shown, setShown] = useState<HudState['toast']>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    const t = setTimeout(() => setShown((s) => (s?.id === toast.id ? null : s)), 4000);
    return () => clearTimeout(t);
  }, [toast?.id]);
  if (!shown) return null;
  return <div key={shown.id} className="hud-toast px-panel" role="status">{shown.text}</div>;
}

// ---- the menu --------------------------------------------------------------------------------------

type MenuProps = {
  view: 'main' | 'controls';
  onView: (v: 'main' | 'controls') => void;
  onClose: () => void;
  superName: string;
  superLocked: boolean;
  superKey: string;
  superIconName: IconName;
  touchFirst: boolean;
};

function Menu({ view, onView, onClose, superName, superLocked, superKey, superIconName, touchFirst }: MenuProps) {
  const first = useRef<HTMLButtonElement>(null);
  const fullscreen = useFullscreen();
  const [layout, keys] = useLayout();
  useEffect(() => { first.current?.focus(); }, [view]);

  return (
    <>
      <div className="hud-scrim" onPointerDown={onClose} aria-hidden="true" />
      <section className={`hud-dialog px-panel is-${view}`} role="dialog" aria-modal="true" aria-labelledby="hud-dialog-title">
        <div className="hud-dialog-head">
          <h2 id="hud-dialog-title" className="hud-title">{view === 'main' ? 'Menu' : 'Controls'}</h2>
          <button type="button" className="btn btn-pine hud-close" onClick={onClose} aria-label="Close menu">
            <span className="btn-face"><Icon name="close" size={3} /></span>
          </button>
        </div>

        {view === 'main' ? (
          <nav className="hud-nav" aria-label="Menu">
            <button ref={first} type="button" className="btn btn-amber btn-big hud-resume" onClick={onClose}>
              <span className="btn-face">Resume</span>
            </button>
            <button type="button" className="btn btn-pine" onClick={() => onView('controls')}>
              <span className="btn-face">Controls</span>
            </button>
            {canFullscreen() && (
              <button type="button" className="btn btn-pine hud-fullscreen" onClick={toggleFullscreen} aria-pressed={fullscreen}>
                <span className="btn-face">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
              </button>
            )}
            <button type="button" className="btn btn-pine" onClick={() => { onClose(); actions.changeFighter(); }}>
              <span className="btn-face">Change fighter</span>
            </button>
            <button type="button" className="btn btn-brick" onClick={() => { onClose(); actions.leave(); }}>
              <span className="btn-face">Leave game</span>
            </button>
          </nav>
        ) : (
          <>
            <div className={`controls${touchFirst ? ' is-touch-first' : ''}`}>
              <section className="controls-keys" aria-labelledby="controls-keys-title">
                <h3 id="controls-keys-title" className="controls-sub">Keyboard</h3>
                <div className="layout-pick" role="radiogroup" aria-label="Keyboard layout">
                  {(Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]).map((id) => (
                    <button key={id} type="button" role="radio" aria-checked={id === layout} className={`btn btn-small ${id === layout ? 'btn-amber' : 'btn-pine'}`}
                      onClick={() => setLayout(id)}>
                      <span className="btn-face">{LAYOUTS[id].name}</span>
                    </button>
                  ))}
                </div>
                <ul className="keymap">
                  <KeyRow keys={layout === 'wasd'
                    ? <span className="keymap-arrows">{(['W', 'A', 'S', 'D'] as const).map((k) => <kbd key={k} className="key">{k}</kbd>)}</span>
                    : <span className="keymap-arrows">{(['up', 'left', 'down', 'right'] as const).map((d) => (
                      <kbd key={d} className="key" aria-label={`${d} arrow`}><Icon name="right" size={2} rotate={{ up: -90, left: 180, right: 0, down: 90 }[d]} /></kbd>
                    ))}</span>} name="Move" note={layout === 'wasd' ? 'Arrows too' : undefined} />
                  <KeyRow keys={<kbd className="key">{keyLabel(keys.punch)}</kbd>} icon="punch" name="Punch" note="Tap: hits the nearest" />
                  <KeyRow keys={<kbd className="key">{keyLabel(keys.kick)}</kbd>} icon="kick" name="Kick" />
                  <KeyRow keys={<kbd className="key">{keyLabel(keys.headbutt)}</kbd>} icon="headbutt" name="Headbutt" />
                  <KeyRow keys={<kbd className="key">{keyLabel(keys.block)}</kbd>} icon="block" name="Block" note={`Hold, up to ${BLOCK.duration / 1000}s`} />
                  <KeyRow
                    keys={superLocked ? <span className="keymap-soon">Soon</span> : <kbd className="key">{keyLabel(keys.super)}</kbd>}
                    icon={superIconName}
                    name={superName}
                    note={superLocked ? 'Not built yet' : 'Super'}
                  />
                  <KeyRow keys={<kbd className="key">{keyLabel(keys.dodge)}</kbd>} icon="dodge" name="Dodge" note="With a direction" />
                  <KeyRow keys={<kbd className="key">E</kbd>} name="Interact" note="Toggle nearest shower" />
                  <KeyRow keys={<kbd className="key">Esc</kbd>} icon="menu" name="Menu" />
                </ul>
              </section>
              <section className="controls-touch" aria-labelledby="controls-touch-title">
                <h3 id="controls-touch-title" className="controls-sub">Touch</h3>
                <div className="phone" aria-hidden="true">
                  <TouchControls
                    demo
                    shield={{ phase: 'ready', endsAt: 0, duration: 1 }}
                    special={superLocked ? { phase: 'locked', endsAt: 0, duration: 1 } : { phase: 'ready', endsAt: 0, duration: 1 }}
                    superName={superName}
                    superIcon={superIconName}
                  />
                </div>
                <p className="controls-note">Move: put your left thumb anywhere on the left half and drag. Fight: tap a move to hit the nearest fighter, or drag it to aim and let go. Dodge sits just above Punch.</p>
              </section>
            </div>
            <button ref={first} type="button" className="btn btn-pine hud-back" onClick={() => onView('main')}>
              <span className="btn-face"><Icon name="back" size={2} /> Back</span>
            </button>
          </>
        )}
      </section>
    </>
  );
}

function KeyRow({ keys, icon, name, note }: { keys: ReactNode; icon?: IconName; name: string; note?: string }) {
  return (
    <li className="keymap-row">
      <span className="keymap-keys">{keys}</span>
      <span className="keymap-name">{icon && <Icon name={icon} size={2} />}{name}</span>
      {note && <span className="keymap-note">{note}</span>}
    </li>
  );
}

function useTouchScreen() {
  const forced = new URLSearchParams(location.search).get('touch');
  const [match, setMatch] = useState(() => matchMedia(TOUCH_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(TOUCH_QUERY);
    const update = () => setMatch(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  if (forced === '1') return true;
  if (forced === '0') return false;
  return match;
}
