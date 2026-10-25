import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';
import {T, In, Scene, Bg, Finish, Logo, H, P, Hl, Card, Doc, Grid, Bolt, QR, Nfc, Lock, Check, Code, Url, Sound, Cue, useV, useEnter, clamp, ease} from './ui';

export const KIT_LEN = 900;

const Label: React.FC<{n: string; t: string; v: boolean}> = ({n, t, v}) => (
  <In d={0} y={30}>
    <div style={{display: 'flex', alignItems: 'center', gap: 22, fontFamily: T.font}}>
      <div style={{fontSize: v ? 40 : 40, fontWeight: 800, color: T.bg, background: T.teal, borderRadius: 14, padding: '6px 16px'}}>{n}</div>
      <div style={{fontSize: v ? 88 : 96, fontWeight: 800, color: T.text, letterSpacing: '-0.03em'}}>{t}</div>
    </div>
  </In>
);

const CardGrid: React.FC<{items: [string, string?][]; v: boolean; icon: 'doc' | 'grid'; d0?: number}> = ({items, v, icon, d0 = 14}) => {
  const fs = v ? 42 : 42;
  const w = v ? 900 : 800;
  return (
    <div style={{display: 'flex', flexWrap: 'wrap', gap: v ? 22 : 26, justifyContent: 'center', maxWidth: v ? 920 : 1680}}>
      {items.map(([t, s], i) => <Card key={t} d={d0 + i * 5} w={w} fs={fs} title={t} sub={s} icon={icon === 'doc' ? <Doc size={fs * 1.3} /> : <Grid size={fs * 1.3} />} />)}
    </div>
  );
};

// Booking flow: slot -> invoice QR -> paid
const Booking: React.FC<{v: boolean}> = ({v}) => {
  const f = useCurrentFrame();
  const paid = useEnter(78, 12);
  const s = v ? 1.2 : 1.1;
  const slots = ['18:00', '19:30', '21:00'];
  const sel = f > 20;
  return (
    <div style={{display: 'flex', flexDirection: v ? 'column' : 'row', alignItems: 'center', gap: v ? 40 : 90, zoom: s} as React.CSSProperties}>
      <In d={8}>
        <div style={{background: T.surface, borderRadius: 28, padding: 30, width: 380, display: 'flex', flexDirection: 'column', gap: 16, border: `2px solid ${T.teal}33`}}>
          <div style={{fontFamily: T.font, fontWeight: 700, fontSize: 34, color: T.text}}>Court 1</div>
          {slots.map((t, i) => {
            const on = i === 1 && sel;
            return <div key={t} style={{fontFamily: T.font, fontWeight: 600, fontSize: 34, padding: '14px 20px', borderRadius: 16, background: on ? T.teal : `${T.bg}AA`, color: on ? T.bg : T.muted, transform: on ? `scale(${1 + 0.04 * Math.min(1, (f - 20) / 6)})` : undefined}}>{t}</div>;
          })}
        </div>
      </In>
      <In d={34} scale>
        <div style={{position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20}}>
          <div style={{position: 'relative'}}>
            <QR size={v ? 300 : 300} seed={3} />
            <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <div style={{width: 364 * paid, height: 364 * paid, borderRadius: 26, background: T.teal, opacity: Math.min(1, paid * 1.5), display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                <Check size={180} p={interpolate(f, [84, 100], [0, 1], {...clamp, easing: ease})} />
              </div>
            </div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 12, fontFamily: T.font, fontWeight: 700, fontSize: 38, color: f > 84 ? T.teal : T.lime}}>
            <Bolt size={42} color={f > 84 ? T.teal : T.lime} />{f > 84 ? 'Paid · court booked' : 'Lightning invoice'}
          </div>
        </div>
      </In>
    </div>
  );
};

// Entry flow: kiosk rotating QR / NFC tap -> lock pulse -> check-in
const Entry: React.FC<{v: boolean}> = ({v}) => {
  const f = useCurrentFrame();
  const seed = Math.floor(f / 20);
  const tap = useEnter(38, 14);
  const open = interpolate(f, [52, 62], [0, 1], {...clamp, easing: ease});
  const pulse = interpolate(f, [54, 82], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const row = useEnter(70, 16);
  return (
    <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: v ? 40 : 34, zoom: v ? 1.2 : 1.12} as React.CSSProperties}>
      <div style={{display: 'flex', alignItems: 'center', gap: v ? 50 : 90}}>
        <In d={6}>
          <div style={{background: T.surface, borderRadius: 30, padding: 26, border: `2px solid ${T.teal}33`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14}}>
            <QR size={v ? 250 : 240} seed={seed + 10} />
            <div style={{fontFamily: T.font, fontWeight: 600, fontSize: 32, color: T.muted}}>Kiosk · rotating QR</div>
          </div>
        </In>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30}}>
          <div style={{transform: `translateX(${(1 - tap) * 80}px)`, opacity: Math.min(1, tap * 1.5)}}><Nfc size={110} p={interpolate(f, [38, 58], [0, 1], clamp)} /></div>
          <div style={{position: 'relative', width: 150, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <div style={{position: 'absolute', width: 150, height: 150, borderRadius: 75, border: `4px solid ${T.lime}`, transform: `scale(${1 + pulse * 0.8})`, opacity: (1 - pulse) * (f > 54 ? 1 : 0)}} />
            <div style={{width: 150, height: 150, borderRadius: 75, background: open > 0.5 ? T.lime : T.surface, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><Lock size={84} open={open} color={open > 0.5 ? T.bg : T.text} /></div>
          </div>
        </div>
      </div>
      <div style={{opacity: Math.min(1, row * 1.3), transform: `translateY(${(1 - row) * 30}px)`, display: 'flex', alignItems: 'center', gap: 16, fontFamily: T.font, fontWeight: 700, fontSize: v ? 40 : 40, color: T.text, background: `${T.teal}22`, border: `2px solid ${T.teal}66`, borderRadius: 20, padding: '16px 28px'}}>
        <div style={{width: 44, height: 44, borderRadius: 22, background: T.teal, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><Check size={32} /></div>
        Check-in recorded
      </div>
    </div>
  );
};

export const Kit: React.FC = () => {
  const v = useV();
  const cues: Cue[] = [
    {f: 0, s: 'hit'}, {f: 10, s: 'whoosh', v: 0.35},
    {f: 88, s: 'whoosh'}, ...[0, 1, 2, 3, 4, 5].map((i) => ({f: 102 + i * 5, s: 'tick' as const})),
    {f: 268, s: 'whoosh'}, ...[0, 1, 2, 3].map((i) => ({f: 282 + i * 5, s: 'tick' as const})),
    {f: 418, s: 'whoosh'}, {f: 440, s: 'pop'}, {f: 454, s: 'pop'}, {f: 500, s: 'chime', v: 0.4},
    {f: 568, s: 'whoosh'}, {f: 606, s: 'pop'}, {f: 621, s: 'hit', v: 0.5}, {f: 638, s: 'chime', v: 0.35},
    {f: 718, s: 'whoosh'}, {f: 740, s: 'pop', v: 0.3},
    {f: 808, s: 'whoosh'}, {f: 820, s: 'hit'},
  ];
  const playbooks: [string, string?][] = v
    ? [['Concept & phases'], ['Pilot court checklist'], ['Bitcoin hub playbook'], ['Lightning integrations'], ['Tournaments & leagues'], ['Community & sponsorship']]
    : [['Concept & phases', 'Community first → flagship'], ['Pilot court checklist'], ['Bitcoin hub playbook', 'Meetups & education'], ['Lightning integrations'], ['Tournaments & leagues'], ['Community & sponsorship', 'Sponsorship, not investment']];
  const templates: [string, string?][] = [['Financial model', 'Blank inputs, your numbers'], ['Founding-member page'], ['Event run-of-show'], ['Sponsor one-pager']];
  return (
    <AbsoluteFill style={{background: T.bg}}>
      <Bg />
      <Scene from={0} dur={90}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40}}>
          <In><P size={v ? 46 : 48} style={{letterSpacing: '0.14em', textTransform: 'uppercase', color: T.teal, fontWeight: 700}}>The BitPadel kit</P></In>
          <In d={8}><H size={v ? 120 : 140}>What’s<br />in the box?</H></In>
        </div>
      </Scene>
      <Scene from={90} dur={180}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: v ? 50 : 50}}>
          <Label n="01" t="Playbooks" v={v} />
          <CardGrid items={playbooks} v={v} icon="doc" />
        </div>
      </Scene>
      <Scene from={270} dur={150}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50}}>
          <Label n="02" t="Templates" v={v} />
          <CardGrid items={templates} v={v} icon="grid" />
        </div>
      </Scene>
      <Scene from={420} dur={150}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: v ? 50 : 40}}>
          <Label n="03" t="Lightning booking" v={v} />
          <Booking v={v} />
        </div>
      </Scene>
      <Scene from={570} dur={150}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: v ? 40 : 30}}>
          <Label n="04" t={v ? 'Entry & check-in' : 'Wallet & NFC entry'} v={v} />
          <In d={8}><P size={v ? 38 : 38}>LNURL-auth login or NFC card tap</P></In>
          <Entry v={v} />
        </div>
      </Scene>
      <Scene from={720} dur={90}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40, padding: '0 60px'}}>
          <In scale><div style={{width: 150, height: 150, borderRadius: 36, background: `${T.teal}22`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><Code size={96} /></div></In>
          <In d={8}><H size={v ? 84 : 96}>Reference app included</H></In>
          <In d={16}><P size={v ? 42 : 44}>Node + SQLite · mock adapters<br />Try it with no node or hardware</P></In>
        </div>
      </Scene>
      <Scene from={810} dur={90} noExit>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50}}>
          <Logo size={v ? 140 : 130} d={4} vertical={v} />
          <Url d={26} size={v ? 40 : 46} />
        </div>
      </Scene>
      <Finish />
      <Sound cues={cues} total={KIT_LEN} />
    </AbsoluteFill>
  );
};
