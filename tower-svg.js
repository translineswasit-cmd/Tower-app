/* tower-svg.js — v335-C5r8
   مولّدات رسم العوازل/السلاسل (SVG) المشتركة بين محرر الكشف ومحرر المعالجة. دوال نقية بلا حالة.
   يُحمَّل ويُنفَّذ مرة واحدة فقط عند الطلب الفعلي؛ لا يعمل عند بدء التطبيق. سكربت كلاسيكي يشارك الربط العام مع index.html. */
function generateVShapeSVG(state) {
  const N=28, svgW=140, svgH=110, gap=18, tipY=svgH-8, tipLX=svgW/2-gap/2, tipRX=svgW/2+gap/2, tlX=8, tlY=8, trX=svgW-8, trY=8, rw=12, rh=7;
  let rects='';
  function makeRect(cx,cy,angle,idx){
    const ca=Math.cos(angle),sa=Math.sin(angle);
    const corners=[[-rw/2,-rh/2],[rw/2,-rh/2],[rw/2,rh/2],[-rw/2,rh/2]];
    const pts=corners.map(([x,y])=>[(cx+x*ca-y*sa).toFixed(2),(cy+x*sa+y*ca).toFixed(2)].join(',')).join(' ');
    const fill=state[idx]?'#FC4444':'white', stroke=state[idx]?'#9B0000':'#555';
    return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>`;
  }
  const angL=Math.atan2(tlY-tipY,tlX-tipLX), angR=Math.atan2(trY-tipY,trX-tipRX);
  for(let i=0;i<N;i++){
    const t=i/(N-1);
    rects+=makeRect(tipLX+(tlX-tipLX)*t,tipY+(tlY-tipY)*t,angL,i);
    rects+=makeRect(tipRX+(trX-tipRX)*t,tipY+(trY-tipY)*t,angR,N+i);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${rects}</svg>`;
}

// نسخة ثلاثية الألوان من V-shape — لسجل المعالجات: أبيض=سليم، أحمر=لسا متضرر، أخضر=عولج بهذي الجلسة
function generateVShapeSVG3Color(state, treatedIdx, cycleArr) {
  const N=28, svgW=140, svgH=110, gap=18, tipY=svgH-8, tipLX=svgW/2-gap/2, tipRX=svgW/2+gap/2, tlX=8, tlY=8, trX=svgW-8, trY=8, rw=12, rh=7;
  const treatedSet = new Set(treatedIdx||[]);
  let rects='';
  function makeRect(cx,cy,angle,idx){
    const ca=Math.cos(angle),sa=Math.sin(angle);
    const corners=[[-rw/2,-rh/2],[rw/2,-rh/2],[rw/2,rh/2],[-rw/2,rh/2]];
    const pts=corners.map(([x,y])=>[(cx+x*ca-y*sa).toFixed(2),(cy+x*sa+y*ca).toFixed(2)].join(',')).join(' ');
    const cyc = (cycleArr&&cycleArr[idx])||0;
    let fill='white', stroke='#555';
    if (treatedSet.has(idx)) { fill=insShade(INS_GREEN_SHADES,cyc); stroke='#276749'; }
    else if (state[idx]) { fill=insShade(INS_RED_SHADES,cyc); stroke='#9B0000'; }
    return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>`;
  }
  const angL=Math.atan2(tlY-tipY,tlX-tipLX), angR=Math.atan2(trY-tipY,trX-tipRX);
  for(let i=0;i<N;i++){
    const t=i/(N-1);
    rects+=makeRect(tipLX+(tlX-tipLX)*t,tipY+(tlY-tipY)*t,angL,i);
    rects+=makeRect(tipRX+(trX-tipRX)*t,tipY+(trY-tipY)*t,angR,N+i);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${rects}</svg>`;
}

function generateChainSVG(state, cols, rows) {
  cols = cols || 2; rows = rows || 12;
  let rects=''; const w=18,h=14,gap=2,colGap=6;
  for(let col=0;col<cols;col++) for(let row=0;row<rows;row++){
    const idx=col*rows+row, x=col*(w+colGap), y=row*(h+gap);
    const fill=state[idx]?'#FC4444':'white', stroke=state[idx]?'#9B0000':'#555';
    rects+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
  const svgW=cols*w+(cols-1)*colGap, svgH=rows*(h+gap)-gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${rects}</svg>`;
}

function generateQuadChainSVG(state, cols, rows) {
  cols = cols || 4; rows = rows || 32;
  let rects=''; const w=11,h=8,gap=1.2,colGap=3.5;
  for(let col=0;col<cols;col++) for(let row=0;row<rows;row++){
    const idx=col*rows+row, x=col*(w+colGap), y=row*(h+gap);
    const fill=state[idx]?'#FC4444':'white', stroke=state[idx]?'#9B0000':'#555';
    rects+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
  }
  const svgW=cols*w+(cols-1)*colGap, svgH=rows*(h+gap)-gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${rects}</svg>`;
}

function generateSingleChainSVG(state, rows) {
  rows = rows || 10;
  let rects=''; const w=18,h=14,gap=2;
  for(let row=0;row<rows;row++){
    const idx=row, y=row*(h+gap);
    const fill=state[idx]?'#FC4444':'white', stroke=state[idx]?'#9B0000':'#555';
    rects+=`<rect x="0" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
  const svgW=w, svgH=rows*(h+gap)-gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${rects}</svg>`;
}

// نسخة ثلاثية الألوان عامة (تدعم 1، 2، أو 4 أعمدة) — لسجل المعالجات
// أبيض=سليم، أحمر=لسا متضرر، أخضر=عولج بهذي الجلسة
// chainTypes (اختياري): مصفوفة مادة كل سلسلة بهذا الفيز (glass/plastic/ceramic) — لو مو موجودة تُعتبر كل السلاسل زجاج (سلوك قديم كما هو)
function generateChainSVG3Color(state, treatedIdx, cols, rows, cycleArr, chainTypes) {
  cols = cols || 2; rows = rows || 12;
  const treatedSet = new Set(treatedIdx||[]);
  const isQuad = cols >= 4;
  const w = isQuad ? 11 : 18, h = isQuad ? 8 : 14, gap = isQuad ? 1.2 : 2, colGap = isQuad ? 3.5 : 6;
  let rects='';
  for(let col=0;col<cols;col++) {
    const material = (chainTypes && chainTypes[col]) || 'glass';
    const colX = col*(w+colGap);
    if (material === 'plastic' || material === 'ceramic') {
      let justReplaced = false;
      for (let row=0; row<rows; row++) { if (treatedSet.has(col*rows+row)) { justReplaced = true; break; } }
      rects += material === 'ceramic' ? ceramicColumnSVGString(colX, w, rows) : plasticColumnSVGString(colX, w, rows, justReplaced);
      continue;
    }
    for(let row=0;row<rows;row++){
      const idx=col*rows+row, x=colX, y=row*(h+gap);
      const cyc = (cycleArr&&cycleArr[idx])||0;
      let fill='white', stroke='#555';
      if (treatedSet.has(idx)) { fill=insShade(INS_GREEN_SHADES,cyc); stroke='#276749'; }
      else if (state[idx]) { fill=insShade(INS_RED_SHADES,cyc); stroke='#9B0000'; }
      const rx = isQuad ? 1.5 : 2, sw = isQuad ? 1 : 1.5;
      rects+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
  }
  const svgW=cols*w+(cols-1)*colGap, svgH=rows*(h+gap)-gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">${rects}</svg>`;
}

(window.__featModules = window.__featModules || {}).svg = true;
