import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing, random, Sequence, Audio, staticFile} from 'remotion';

export const T = {
  bg: '#0F172A', surface: '#1E293B', text: '#F8FAFC', muted: '#94A3B8',
  teal: '#14B8A6', lime: '#D9F99D', font: 'Inter, "Inter Tight", system-ui, sans-serif',
};
export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const useV = () => { const {width, height} = useVideoConfig(); return width < height; };

export const useEnter = (delay = 0, damping = 18) => {
  const f = useCurrentFrame(); const {fps} = useVideoConfig();
  return spring({frame: f - delay, fps, config: {damping, mass: 0.7, stiffness: 120}});
};

// Entrance: opacity + translateY + blur (3 props)
export const In: React.FC<{d?: number; y?: number; children: React.ReactNode; style?: React.CSSProperties; scale?: boolean}> = ({d = 0, y = 40, children, style, scale}) => {
  const p = useEnter(d);
  return <div style={{opacity: Math.min(1, p * 1.2), transform: `translateY(${(1 - p) * y}px)${scale ? ` scale(${0.85 + 0.15 * p})` : ''}`, filter: `blur(${(1 - Math.min(1, p)) * 8}px)`, ...style}}>{children}</div>;
};

// Scene wrapper with fast exit
export const Scene: React.FC<{from: number; dur: number; children: React.ReactNode; noExit?: boolean}> = ({from, dur, children, noExit}) => (
  <Sequence from={from} durationInFrames={dur}><SceneInner dur={dur} noExit={noExit}>{children}</SceneInner></Sequence>
);
const SceneInner: React.FC<{dur: number; children: React.ReactNode; noExit?: boolean}> = ({dur, children, noExit}) => {
  const f = useCurrentFrame();
  const o = noExit ? 1 : interpolate(f, [dur - 10, dur], [1, 0], {...clamp, easing: Easing.in(Easing.cubic)});
  const s = noExit ? 1 : interpolate(f, [dur - 10, dur], [1, 1.04], {...clamp, easing: Easing.in(Easing.cubic)});
  const b = noExit ? 0 : interpolate(f, [dur - 10, dur], [0, 10], clamp);
  return <AbsoluteFill style={{opacity: o, transform: `scale(${s})`, filter: b ? `blur(${b}px)` : undefined, justifyContent: 'center', alignItems: 'center'}}>{children}</AbsoluteFill>;
};

export const Bg: React.FC = () => {
  const f = useCurrentFrame(); const {width, height} = useVideoConfig();
  const a = f / 30;
  const x1 = 30 + Math.sin(a * 0.35) * 12, y1 = 30 + Math.cos(a * 0.27) * 10;
  const x2 = 70 + Math.cos(a * 0.3) * 12, y2 = 72 + Math.sin(a * 0.22) * 10;
  return (
    <AbsoluteFill style={{background: T.bg}}>
      <AbsoluteFill style={{background: `radial-gradient(ellipse 60% 50% at ${x1}% ${y1}%, ${T.teal}2E, transparent 70%), radial-gradient(ellipse 50% 45% at ${x2}% ${y2}%, ${T.lime}14, transparent 70%), radial-gradient(ellipse 80% 60% at 50% 110%, ${T.surface}, transparent 70%)`}} />
      <Court w={width} h={height} />
    </AbsoluteFill>
  );
};

// Faint padel-court lines, slowly drifting (perspective)
const Court: React.FC<{w: number; h: number}> = ({w, h}) => {
  const f = useCurrentFrame();
  const v = h > w;
  const cw = v ? w * 0.9 : w * 0.5, ch = v ? h * 0.75 : h * 0.9;
  const rot = 58 + Math.sin(f / 90) * 2;
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', perspective: 1400, opacity: 0.13}}>
      <svg width={cw} height={ch} viewBox="0 0 100 200" preserveAspectRatio="none" style={{transform: `rotateX(${rot}deg) translateY(${h * 0.12}px) rotateZ(${Math.sin(f / 120) * 1.5}deg)`}}>
        <g fill="none" stroke={T.teal} strokeWidth={0.8} vectorEffect="non-scaling-stroke">
          <rect x="1" y="1" width="98" height="198" strokeWidth={1.2} />
          <line x1="0" y1="100" x2="100" y2="100" stroke={T.lime} />
          <line x1="1" y1="30" x2="99" y2="30" /><line x1="1" y1="170" x2="99" y2="170" />
          <line x1="50" y1="30" x2="50" y2="170" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export const Finish: React.FC = () => {
  const f = useCurrentFrame();
  const seed = Math.floor(f / 2);
  return (
    <>
      <AbsoluteFill style={{background: `linear-gradient(180deg, ${T.teal}08, transparent 40%, ${T.bg}55)`, mixBlendMode: 'soft-light'}} />
      <AbsoluteFill style={{opacity: 0.045, mixBlendMode: 'overlay'}}>
        <svg width="100%" height="100%"><filter id={`n${seed}`}><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} /></filter><rect width="100%" height="100%" filter={`url(#n${seed})`} /></svg>
      </AbsoluteFill>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(2,6,23,0.65) 100%)'}} />
    </>
  );
};

// ---------- Glyphs ----------
export const Mark: React.FC<{size: number; d?: number}> = ({size, d = 0}) => {
  const f = useCurrentFrame();
  const p = interpolate(f - d, [0, 28], [0, 1], {...clamp, easing: ease});
  const ball = useEnter(d + 18, 10);
  const breathe = 1 + Math.sin((f - d) / 18) * 0.015;
  const C = 2 * Math.PI * 44;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{transform: `scale(${breathe})`, overflow: 'visible'}}>
      <circle cx="50" cy="50" r="44" fill={T.teal} fillOpacity={0.1 * p} stroke={T.teal} strokeWidth="5" strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 50 50)" strokeLinecap="round" />
      <line x1="50" y1="10" x2="50" y2="90" stroke={T.teal} strokeWidth="3.5" strokeDasharray="80" strokeDashoffset={80 * (1 - p)} opacity={0.85} />
      <line x1="10" y1="50" x2="90" y2="50" stroke={T.teal} strokeWidth="3.5" strokeDasharray="80" strokeDashoffset={80 * (1 - p)} opacity={0.85} />
      <circle cx="68" cy="32" r={11 * ball} fill={T.lime} />
    </svg>
  );
};

export const Wordmark: React.FC<{size: number; d?: number}> = ({size, d = 0}) => (
  <div style={{display: 'flex', fontFamily: T.font, fontWeight: 800, fontSize: size, letterSpacing: '-0.035em', lineHeight: 1}}>
    {'BitPadel'.split('').map((c, i) => (
      <In key={i} d={d + i * 3} y={size * 0.4}><span style={{color: i < 3 ? T.text : T.teal}}>{c}</span></In>
    ))}
  </div>
);

export const Logo: React.FC<{size?: number; d?: number; vertical?: boolean}> = ({size = 140, d = 0, vertical}) => (
  <div style={{display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', gap: size * 0.3}}>
    <Mark size={size} d={d} />
    <Wordmark size={size * 0.78} d={d + 12} />
  </div>
);

export const Bolt: React.FC<{size: number; color?: string}> = ({size, color = T.lime}) => (
  <svg width={size} height={size} viewBox="0 0 24 24"><path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.6L13.5 2Z" fill={color} /></svg>
);
export const Check: React.FC<{size: number; p?: number; color?: string}> = ({size, p = 1, color = T.bg}) => (
  <svg width={size} height={size} viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={22} strokeDashoffset={22 * (1 - p)} /></svg>
);
export const Doc: React.FC<{size: number; color?: string}> = ({size, color = T.teal}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z" /><path d="M14 3v5h5M8.5 13h7M8.5 17h5" /></svg>
);
export const Grid: React.FC<{size: number; color?: string}> = ({size, color = T.teal}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M3.5 9.5h17M9.5 3.5v17" /></svg>
);
export const Nfc: React.FC<{size: number; color?: string; p?: number}> = ({size, color = T.teal, p = 1}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
    {[4, 8, 12].map((r, i) => <path key={r} d={`M${6 + r * 0.5} ${12 - r * 0.75}a${r} ${r} 0 0 1 0 ${r * 1.5}`} opacity={interpolate(p * 3 - i, [0, 1], [0.15, 1], clamp)} />)}
    <circle cx="5" cy="12" r="1.6" fill={color} />
  </svg>
);
export const Lock: React.FC<{size: number; open?: number; color?: string}> = ({size, open = 0, color = T.text}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d={`M8 10.5V7.5a4 4 0 0 1 8 0${open > 0.5 ? '' : 'v3'}`} transform={`translate(0 ${-open * 2.5})`} /></svg>
);
export const Person: React.FC<{size: number; color?: string}> = ({size, color = T.teal}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" /></svg>
);
export const Code: React.FC<{size: number; color?: string}> = ({size, color = T.teal}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" /></svg>
);
export const Cap: React.FC<{size: number; color?: string}> = ({size, color = T.teal}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round"><path d="M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5Z" /><path d="M6.5 11.5v4.5c1.5 1.5 3.5 2 5.5 2s4-.5 5.5-2v-4.5M21.5 9.5v5" /></svg>
);
export const Racket: React.FC<{size: number; color?: string}> = ({size, color = T.teal}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round"><ellipse cx="10" cy="9" rx="6" ry="6.5" /><path d="M14 14l5.5 6" strokeWidth={3} /><circle cx="8" cy="7.5" r=".9" fill={color} /><circle cx="11.5" cy="7.5" r=".9" fill={color} /><circle cx="9.8" cy="10.8" r=".9" fill={color} /></svg>
);
export const Cube: React.FC<{size: number; color?: string}> = ({size, color = T.muted}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" /><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10" /></svg>
);

export const QR: React.FC<{size: number; seed: number}> = ({size, seed}) => {
  const n = 21; const cells: React.ReactNode[] = [];
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (finder(x, y)) continue;
    if (random(`q${seed}-${x}-${y}`) > 0.52) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} />);
  }
  const F = ({x, y}: {x: number; y: number}) => (<g><rect x={x} y={y} width={7} height={7} /><rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" /><rect x={x + 2} y={y + 2} width={3} height={3} /></g>);
  return (
    <div style={{background: '#fff', padding: size * 0.06, borderRadius: size * 0.06}}>
      <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} fill={T.bg} shapeRendering="crispEdges">{cells}<F x={0} y={0} /><F x={n - 7} y={0} /><F x={0} y={n - 7} /></svg>
    </div>
  );
};

// Highlight pill behind one word
export const Hl: React.FC<{d: number; children: React.ReactNode; color?: string; text?: string}> = ({d, children, color = T.teal, text = T.bg}) => {
  const p = useEnter(d, 20);
  return (
    <span style={{position: 'relative', display: 'inline-block', color: p > 0.5 ? text : T.text}}>
      <span style={{position: 'absolute', inset: '-0.02em -0.14em', background: color, borderRadius: '0.16em', transform: `scaleX(${p})`, transformOrigin: 'left', zIndex: -1}} />
      {children}
    </span>
  );
};

export const H: React.FC<{size: number; children: React.ReactNode; style?: React.CSSProperties}> = ({size, children, style}) => (
  <div style={{fontFamily: T.font, fontWeight: 800, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1.06, color: T.text, textAlign: 'center', position: 'relative', zIndex: 0, ...style}}>{children}</div>
);
export const P: React.FC<{size: number; children: React.ReactNode; style?: React.CSSProperties}> = ({size, children, style}) => (
  <div style={{fontFamily: T.font, fontWeight: 500, fontSize: size, lineHeight: 1.3, color: T.muted, textAlign: 'center', ...style}}>{children}</div>
);

export const Card: React.FC<{d: number; icon: React.ReactNode; title: string; sub?: string; w: number; fs: number}> = ({d, icon, title, sub, w, fs}) => {
  const f = useCurrentFrame();
  const p = useEnter(d);
  const bob = Math.sin((f - d) / 22 + d) * 3 * Math.min(1, p);
  return (
    <div style={{width: w, opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 60 + bob}px) scale(${0.9 + 0.1 * p})`, filter: `blur(${(1 - Math.min(1, p)) * 6}px)`, background: `linear-gradient(160deg, ${T.surface}, ${T.surface}CC)`, border: `2px solid ${T.teal}33`, borderRadius: 28, padding: `${fs * 0.8}px ${fs * 0.9}px`, display: 'flex', alignItems: 'center', gap: fs * 0.7, boxShadow: '0 20px 50px rgba(0,0,0,0.35)', boxSizing: 'border-box', minHeight: fs * 3.6}}>
      <div style={{flexShrink: 0, width: fs * 2.2, height: fs * 2.2, borderRadius: 18, background: `${T.teal}1F`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{icon}</div>
      <div style={{fontFamily: T.font}}>
        <div style={{fontSize: fs, fontWeight: 700, color: T.text, letterSpacing: '-0.01em', lineHeight: 1.15}}>{title}</div>
        {sub && <div style={{fontSize: fs * 0.72, fontWeight: 500, color: T.muted, marginTop: 6, lineHeight: 1.25}}>{sub}</div>}
      </div>
    </div>
  );
};

export const Url: React.FC<{d: number; size: number}> = ({d, size}) => {
  const p = useEnter(d, 16); const f = useCurrentFrame();
  const glow = 0.6 + Math.sin((f - d) / 14) * 0.25;
  return (
    <div style={{opacity: Math.min(1, p * 1.2), transform: `translateY(${(1 - p) * 30}px) scale(${0.92 + 0.08 * p})`, fontFamily: T.font, fontWeight: 700, fontSize: size, color: T.bg, background: T.lime, padding: `${size * 0.42}px ${size * 0.8}px`, borderRadius: size * 2, letterSpacing: '-0.01em', boxShadow: `0 0 ${60 * glow}px ${T.lime}55, 0 0 ${120 * glow}px ${T.lime}22`, whiteSpace: 'nowrap'}}>
      github.com/vectordesigngroup/bitpadel
    </div>
  );
};

// ---------- Audio ----------
export type Cue = {f: number; s: 'whoosh' | 'pop' | 'tick' | 'chime' | 'hit'; v?: number};
export const Sound: React.FC<{cues: Cue[]; total: number; musicStart?: number}> = ({cues, total, musicStart = 0}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      <Audio src={staticFile('music.mp3')} startFrom={musicStart} volume={(f) => interpolate(f, [0, 12, total - 45, total - 2], [0, 0.55, 0.55, 0], clamp)} />
      {cues.map((c, i) => (
        <Sequence key={i} from={Math.max(0, c.f)} durationInFrames={fps * 1.2}>
          <Audio src={staticFile(`${c.s}.wav`)} volume={c.v ?? (c.s === 'whoosh' ? 0.5 : c.s === 'hit' ? 0.7 : 0.45)} />
        </Sequence>
      ))}
    </>
  );
};
