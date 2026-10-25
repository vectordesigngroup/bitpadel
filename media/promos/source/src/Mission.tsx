import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';
import {T, In, Scene, Bg, Finish, Logo, H, P, Hl, Cube, Racket, Person, Bolt, Url, Sound, Cue, useV, useEnter, clamp, ease} from './ui';

export const MISSION_LEN = 900;

const Blocks: React.FC<{s: number}> = ({s}) => {
  return (
    <div style={{display: 'flex', gap: s * 0.25}}>
      {[0, 1, 2, 3].map((i) => <In key={i} d={12 + i * 5} y={50} scale><Cube size={s} color={i === 3 ? T.teal : T.muted} /></In>)}
    </div>
  );
};

const Energy: React.FC<{s: number; v: boolean}> = ({s, v}) => {
  const f = useCurrentFrame();
  // ball bouncing across, eased arcs
  const t = (f % 40) / 40;
  const hop = Math.sin(Math.PI * t);
  const items = [<Racket size={s} />, <Person size={s} />, <Bolt size={s} color={T.lime} />];
  const labels = ['sport', 'community', 'adoption'];
  return (
    <div style={{display: 'flex', alignItems: 'flex-start', gap: v ? s * 0.35 : s * 0.7}}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <In d={10 + i * 14} y={40} scale>
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14}}>
              <div style={{width: s * 1.5, height: s * 1.5, borderRadius: '50%', background: i === 2 ? `${T.lime}22` : `${T.teal}1A`, border: `3px solid ${i === 2 ? T.lime : T.teal}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: i === 2 ? `translateY(${-hop * 6}px)` : undefined}}>{it}</div>
              <div style={{fontFamily: T.font, fontWeight: 600, fontSize: v ? 38 : 40, color: i === 2 ? T.lime : T.text}}>{labels[i]}</div>
            </div>
          </In>
          {i < 2 && <In d={18 + i * 14} y={0}><Arrow w={v ? s * 0.4 : s * 0.7} top={s * 0.75} /></In>}
        </React.Fragment>
      ))}
    </div>
  );
};
const Arrow: React.FC<{w: number; top: number}> = ({w, top}) => (
  <svg width={w} height={20} style={{marginTop: top - 10}} viewBox="0 0 60 20"><path d="M2 10h50M44 3l8 7-8 7" stroke={T.muted} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const Principles: React.FC<{v: boolean}> = ({v}) => {
  const items = ['Community first', 'Lightning everywhere', 'Education, not promotion', 'Open by default'];
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: v ? 26 : 22, alignItems: 'center'}}>
      {items.map((t, i) => (
        <In key={t} d={10 + i * 6} y={30}>
          <div style={{display: 'flex', alignItems: 'center', gap: 20, fontFamily: T.font, fontWeight: 700, fontSize: v ? 62 : 64, color: T.text, letterSpacing: '-0.02em'}}>
            <div style={{width: 18, height: 18, borderRadius: 9, background: i === 0 ? T.lime : T.teal}} />{t}
          </div>
        </In>
      ))}
    </div>
  );
};

export const Mission: React.FC = () => {
  const v = useV();
  const hs = v ? 104 : 120;
  const cues: Cue[] = [
    {f: 0, s: 'hit'}, {f: 16, s: 'pop'},
    {f: 118, s: 'whoosh'}, {f: 132, s: 'tick'}, {f: 137, s: 'tick'}, {f: 142, s: 'tick'}, {f: 147, s: 'pop'},
    {f: 298, s: 'whoosh'}, {f: 310, s: 'pop'}, {f: 324, s: 'pop'}, {f: 338, s: 'chime', v: 0.35},
    {f: 478, s: 'whoosh'}, {f: 490, s: 'hit', v: 0.5}, {f: 540, s: 'pop', v: 0.3},
    {f: 658, s: 'whoosh'}, {f: 670, s: 'tick'}, {f: 676, s: 'tick'}, {f: 682, s: 'tick'}, {f: 688, s: 'tick'},
    {f: 778, s: 'whoosh'}, {f: 790, s: 'hit'}, {f: 830, s: 'chime', v: 0.35},
  ];
  return (
    <AbsoluteFill style={{background: T.bg}}>
      <Bg />
      <Scene from={0} dur={120}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50}}>
          <Logo size={v ? 170 : 160} vertical={v} />
          <In d={36}><P size={v ? 50 : 52} style={{color: T.text, fontWeight: 600}}>The open-source <span style={{color: T.lime}}>Bitcoin padel club</span><br />in a box</P></In>
        </div>
      </Scene>
      <Scene from={120} dur={180}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 60, padding: '0 70px'}}>
          <Blocks s={v ? 130 : 130} />
          <In d={30}><H size={hs}>Bitcoin miners turn<br />energy into blocks.</H></In>
        </div>
      </Scene>
      <Scene from={300} dur={180}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 60, padding: '0 60px'}}>
          <In d={0}><H size={v ? 84 : 96}>A BitPadel club turns<br />a different energy</H></In>
          <Energy s={v ? 120 : 130} v={v} />
          <In d={60}><H size={v ? 84 : 96}>into <Hl d={66}>Bitcoin adoption.</Hl></H></In>
        </div>
      </Scene>
      <Scene from={480} dur={180}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 56, padding: '0 70px'}}>
          <In d={6}><H size={v ? 110 : 128}>A different way<br />to <span style={{color: T.lime}}>“mine”</span> Bitcoin</H></In>
          <In d={50}>
            <div style={{fontFamily: T.font, fontWeight: 600, fontSize: v ? 44 : 42, color: T.text, background: `${T.surface}EE`, border: `2px solid ${T.muted}55`, borderRadius: 24, padding: '22px 34px', textAlign: 'center', lineHeight: 1.35, maxWidth: v ? 900 : 1300}}>
              <span style={{color: T.lime}}>It’s a metaphor.</span>{v ? <br /> : ' '}Clubs don’t mine Bitcoin,<br />and no one earns Bitcoin or returns.
            </div>
          </In>
        </div>
      </Scene>
      <Scene from={660} dur={120}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50}}>
          <In><P size={v ? 44 : 44} style={{letterSpacing: '0.14em', textTransform: 'uppercase', color: T.teal, fontWeight: 700}}>Built on</P></In>
          <Principles v={v} />
        </div>
      </Scene>
      <Scene from={780} dur={120} noExit>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 56}}>
          <Logo size={v ? 150 : 140} d={6} vertical={v} />
          <In d={30}><P size={v ? 46 : 48} style={{color: T.text}}>Free &amp; open source. Start your club.</P></In>
          <Url d={44} size={v ? 40 : 46} />
        </div>
      </Scene>
      <Finish />
      <Sound cues={cues} total={MISSION_LEN} />
    </AbsoluteFill>
  );
};
