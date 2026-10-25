import React from 'react';
import {registerRoot, Composition} from 'remotion';
import {Mission, MISSION_LEN} from './Mission';
import {Kit, KIT_LEN} from './Kit';
import {Cta, CTA_LEN} from './Cta';
const comps = [['Mission', Mission, MISSION_LEN], ['Kit', Kit, KIT_LEN], ['Cta', Cta, CTA_LEN]] as const;
const Root = () => (<>
  {comps.map(([id, C, len]) => (<React.Fragment key={id}>
    <Composition id={`${id}-16x9`} component={C} durationInFrames={len} fps={30} width={1920} height={1080} />
    <Composition id={`${id}-9x16`} component={C} durationInFrames={len} fps={30} width={1080} height={1920} />
  </React.Fragment>))}
</>);
registerRoot(Root);
