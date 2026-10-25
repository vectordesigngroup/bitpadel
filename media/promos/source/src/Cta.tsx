import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import {T, In, Scene, Bg, Finish, Logo, H, P, Hl, Person, Racket, Cap, Code, Url, Sound, Cue, useV, useEnter, clamp, ease} from './ui';

export const CTA_LEN = 900;

const Role: React.FC<{icon: React.ReactNode; who: string; what: string; v: boolean}> = ({icon, who, what, v}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44, padding: '0 70px'}}>
    <In scale y={30}><div style={{width: 200, height: 200, borderRadius: 100, background: `${T.teal}1F`, border: `3px solid ${T.teal}66`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{icon}</div></In>
    <In d={6}><H size={v ? 110 : 128}>{who}</H></In>
    <In d={14}><P size={v ? 50 : 54} style={{color: T.text, fontWeight: 500, maxWidth: v ? 900 : 1400}}>{what}</P></In>
  </div>
);

export const Cta: React.FC = () => {
  const v = useV();
  const ic = 120;
  const cues: Cue[] = [
    {f: 0, s: 'hit'}, {f: 40, s: 'pop'},
    {f: 118, s: 'whoosh'}, {f: 126, s: 'pop'},
    {f: 208, s: 'whoosh'}, {f: 216, s: 'pop'},
    {f: 298, s: 'whoosh'}, {f: 306, s: 'pop'},
    {f: 388, s: 'whoosh'}, {f: 396, s: 'pop'},
    {f: 478, s: 'whoosh'}, {f: 488, s: 'tick'}, {f: 502, s: 'tick'}, {f: 516, s: 'tick'}, {f: 526, s: 'pop'},
    {f: 598, s: 'whoosh'}, {f: 606, s: 'pop'}, {f: 622, s: 'pop', v: 0.3}, {f: 718, s: 'whoosh'}, {f: 728, s: 'hit'}, {f: 772, s: 'chime', v: 0.4},
  ];
  const lines = ['Fork it.', 'Adapt it.', 'Share back.'];
  return (
    <AbsoluteFill style={{background: T.bg}}>
      <Bg />
      <Scene from={0} dur={120}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40, padding: '0 70px'}}>
          <In><H size={v ? 116 : 130}>Bring Bitcoin<br />to the {v && <br />}<Hl d={14}>padel court.</Hl></H></In>
          <In d={36}><P size={v ? 48 : 52}>BitPadel is looking for builders.</P></In>
        </div>
      </Scene>
      <Scene from={120} dur={90}><Role v={v} icon={<Racket size={ic} />} who="Club founders" what="Start small with the phase playbooks and pilot checklist." /></Scene>
      <Scene from={210} dur={90}><Role v={v} icon={<Person size={ic} />} who="Coaches" what="Run Bitcoin-friendly clinics, tournaments and leagues." /></Scene>
      <Scene from={300} dur={90}><Role v={v} icon={<Cap size={ic} />} who="Bitcoin educators" what="Host meetups and classes in the club’s Bitcoin hub." /></Scene>
      <Scene from={390} dur={90}><Role v={v} icon={<Code size={ic} />} who="Lightning devs" what="Hack on booking, LNURL-auth and NFC entry." /></Scene>
      <Scene from={480} dur={120}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50}}>
          <div style={{display: 'flex', flexDirection: v ? 'column' : 'row', gap: v ? 20 : 50, alignItems: 'center'}}>
            {lines.map((l, i) => <In key={l} d={10 + i * 14} y={50}><H size={v ? 120 : 120} style={{color: i === 2 ? T.lime : T.text}}>{l}</H></In>)}
          </div>
          <In d={60}><P size={v ? 42 : 46}>Code MIT · Docs CC BY-SA 4.0</P></In>
        </div>
      </Scene>
      <Scene from={600} dur={120}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44, padding: '0 70px'}}>
          <In><H size={v ? 96 : 110}>Your club.<br /><span style={{color: T.teal}}>Your brand.</span></H></In>
          <In d={20}><P size={v ? 46 : 50} style={{color: T.text}}>“Built with the open BitPadel kit.”</P></In>
          <In d={30}><P size={v ? 38 : 40}>Playbooks · templates · Lightning reference app</P></In>
        </div>
      </Scene>
      <Scene from={720} dur={180} noExit>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: v ? 60 : 56}}>
          <Logo size={v ? 160 : 140} d={6} vertical={v} />
          <In d={30}><H size={v ? 72 : 80}>Start your club today.</H></In>
          <Url d={50} size={v ? 40 : 50} />
          <In d={70}><P size={v ? 36 : 38}>Free and open source · Contributions welcome</P></In>
        </div>
      </Scene>
      <Finish />
      <Sound cues={cues} total={CTA_LEN} musicStart={0} />
    </AbsoluteFill>
  );
};
