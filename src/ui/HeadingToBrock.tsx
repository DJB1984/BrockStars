import { useEffect, useState, type CSSProperties } from 'react';
import { Sprite, spriteFrame } from './Sprite';

// The trip to Brock: shown over the lobby while Play puts you in the shared game. Your fighter walks in
// place while the road and the treeline scroll past, BROCK bounces in, and a line of what's happening
// changes under the bar.

const LINES = [
  'Lacing up',
  'Crossing the quad',
  'Dodging the RA',
  'Taking the stairs',
  'Finding the dorm',
  'Knocking on the door',
];
const LINE_MS = 900;
const WORD = 'BROCK';
// Every fighter at the same scale, so the tall ones stay tall, feet on the road.
const SCALE = 3;
const FEET_Y = 210;   // the road, in px from the top of the scene

export function HeadingToBrock({ fighter }: { fighter: string }) {
  const [line, setLine] = useState(0);
  const [frame, setFrame] = useState<{ crop: [number, number, number, number]; top: number } | null>(null);
  useEffect(() => {
    let live = true;
    spriteFrame(fighter).then((f) => {
      if (!live || !f) return;
      // from just over the head to just under the feet
      const y = Math.max(0, f.body.y - 2), feet = f.origin[1];
      setFrame({ crop: [8, y, 48, feet + 2 - y], top: FEET_Y - (feet - y) * SCALE });
    }).catch(() => {});
    return () => { live = false; };
  }, [fighter]);

  useEffect(() => {
    const timer = setInterval(() => setLine((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="trip" role="status" aria-live="polite" aria-label="Heading to Brock">
      <div className="trip-title" aria-hidden="true">
        <span className="trip-heading">Heading to</span>
        <span className="trip-word">
          {[...WORD].map((ch, i) => (
            <span key={i} className="trip-letter" style={{ '--i': i } as CSSProperties}>{ch}</span>
          ))}
        </span>
      </div>

      <div className="trip-road" aria-hidden="true">
        <i className="trip-trees" />
        {frame && (
          <Sprite id={fighter} anim="walk_side" scale={SCALE} crop={frame.crop} className="trip-walker"
                  style={{ top: frame.top }} />
        )}
        <i className="trip-lane" />
      </div>

      <div className="trip-bar" aria-hidden="true" />
      <p key={line} className="trip-line">{LINES[line]}</p>
    </div>
  );
}
