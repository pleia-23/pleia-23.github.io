/* ===== 图觅 PicSeek 全站通用脚本 =====
   复用既有能力：多源搜索(走服务端代理,前端零密钥)、canvas 提色、和谐度打分、
   收藏(localStorage,含描述/主色供影集自动分类)、内容自动识别分层。
   所有函数挂在 window 上，各页面直接调用。 */

const API_BASE = 'https://tumi-d9guyt1ju744e0622.service.tcloudbase.com';
// 照片数据接口（含全部精选图与配色）：
//   优先同源静态文件 /photos.json —— GitHub Pages / CloudStudio 静态托管直接 serve，
//   自带 CDN + 浏览器缓存，最快最稳，且不需要跨域代理。
//   海外 / 旧环境取不到时，再走服务端代理 /api/photos 兜底（代理带 CORS 头）。
const PROXY_PHOTOS_URL = API_BASE + '/api/photos';
// 同源静态 photos.json 的绝对路径：从「当前页面所在目录」推导，
// 这样无论是首页 / 还是子页面 color.html，都能正确指向站点根目录的 photos.json。
const STATIC_PHOTOS_URL = (location.pathname.replace(/[^/]*$/, '')) + 'photos.json';

/* ---------- 照片数据加载（带本地缓存，避免重复下载） ----------
   优先读同源 /photos.json（静态、秒开），失败才走代理兜底；
   首次加载后把数据存进浏览器本地（localStorage），之后打开秒出，
   后台再静默刷新一次。所有功能照常，不丢任何特性。 */
const LS_PHOTOS = 'picseek_photos_v1';
// 站点根目录（用于拼分片路径，兼容首页/子页面）
function _staticBase(){ return location.pathname.replace(/[^/]*$/, ''); }
// 分片加载：photos.0.json / photos.1.json ... 直到取不到（404）为止，合并 results
async function _loadChunked(){
  const base = _staticBase();
  const out = [];
  for(let i=0; i<9999; i++){
    const r = await fetch(base + 'photos.' + i + '.json', {cache:'force-cache'});
    if(!r.ok) break;                       // 没有下一片就结束
    const j = await r.json();
    if(j && Array.isArray(j.results)) out.push(...j.results);
    else if(Array.isArray(j)) out.push(...j);
  }
  if(out.length === 0) throw new Error('no photos chunks found');
  return {results: out};
}
async function loadPhotosData(){
  let cached = null;
  try{ const raw = localStorage.getItem(LS_PHOTOS); if(raw) cached = JSON.parse(raw); }catch(e){}
  const stash = (j)=>{ try{ localStorage.setItem(LS_PHOTOS, JSON.stringify(j)); }catch(e){} };
  if(cached){
    // 先用缓存秒开，后台静默刷新（分片静态优先，再单文件，再代理）
    _loadChunked().then(stash).catch(()=>fetch(STATIC_PHOTOS_URL,{cache:'force-cache'}).then(r=>r.json()).then(stash).catch(()=>{}));
    return cached;
  }
  // 首次：分片静态 -> 单文件 photos.json -> 代理兜底
  try{ const j = await _loadChunked(); stash(j); return j; }
  catch(e){
    try{ const j = await fetch(STATIC_PHOTOS_URL,{cache:'force-cache'}).then(r=>{if(!r.ok)throw 0;return r.json();}); stash(j); return j; }
    catch(e2){ const j = await fetch(PROXY_PHOTOS_URL,{cache:'force-cache'}).then(r=>{if(!r.ok)throw 0;return r.json();}); stash(j); return j; }
  }
}

/* ---------- 多图源配置（前端只放名字+能否搜；密钥全在服务端） ---------- */
const SOURCES = {
  unsplash:{label:'Unsplash',search:true},
  pexels:{label:'Pexels',search:true},
  pixabay:{label:'Pixabay',search:true},
  wikimedia:{label:'维基共享',search:true},
  bing:{label:'必应壁纸',search:false},
};
// 默认开启：unsplash + pexels（服务端有密钥）+ bing（无需Key）。pixabay/wikimedia 暂关。
const DEFAULT_CFG = { sources:{unsplash:true,pexels:true,pixabay:false,wikimedia:false,bing:true}, orient:'all' };

/* ---------- 统一字段 ---------- */
function normalizePhoto(p, source){
  if(!p || !p.id) return null;
  if(p.thumb || p.full) return {...p, source:source||p.source};
  if(p.urls){ const u=p.urls; return {
    id:String(p.id), source, thumb:u.small||u.thumb||u.regular, full:u.full||u.raw,
    w:p.width||0, h:p.height||0, photographer:(p.user&&p.user.name)||'未知',
    photographerLink:(p.user&&p.user.links&&p.user.links.html)||'',
    pageLink:(p.links&&p.links.html)||'',
    downloadLocation:(p.links&&p.links.download_location)||'',
    desc:(p.alt_description||p.description||'') }; }
  if(p.src){ const s=p.src; return {
    id:String(p.id), source, thumb:s.large||s.medium, full:s.original,
    w:p.width||0, h:p.height||0, photographer:p.photographer||'未知',
    photographerLink:p.photographer_url||'', pageLink:p.url||'',
    desc:(p.alt||'') }; }
  if(p.webformatURL){ return {
    id:String(p.id), source, thumb:p.webformatURL, full:p.largeImageURL,
    w:p.imageWidth||0, h:p.imageHeight||0, photographer:p.user||'未知',
    photographerLink:p.pageURL||'', pageLink:p.pageURL||'',
    desc:(p.tags||'') }; }
  return {...p, source:source||p.source};
}

/* ---------- 多源抓取（前端只发请求到代理） ---------- */
async function fetchSource(name, q, page, per=15, orient='all', color=''){
  const o = orient!=='all'?`&orientation=${orient}`:'';
  const c = color?`&color=${encodeURIComponent(color)}`:'';
  try{
    const r = await fetch(`${API_BASE}/api/${name}?q=${encodeURIComponent(q)}&page=${page}&per_page=${per}${o}${c}`);
    if(!r.ok) return [];
    const j = await r.json().catch(()=>null);
    const list = (j&&j.results) ? j.results : (Array.isArray(j)?j:[]);
    return list.map(p=>normalizePhoto(p, name)).filter(p=>p && p.thumb);
  }catch(e){ return []; }
}

/* ---------- 颜色工具 ---------- */
function rgb2hsl(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  let h=0,s=0,l=(mx+mn)/2;
  if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    if(mx===r)h=(g-b)/d+(g<b?6:0);
    else if(mx===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;}
  return {h,s,l};
}
function rgb2hex(r,g,b){
  const f=v=>{v=Math.max(0,Math.min(255,Math.round(v||0)));return v.toString(16).padStart(2,'0');};
  return '#'+f(r)+f(g)+f(b);
}
function hex2rgb(hex){
  hex=hex.replace('#','');
  return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)];
}
function hueDist(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
function hsl2rgb(h,s,l){
  h/=360; let r,g,b;
  if(s===0){r=g=b=l;}
  else{const q=l<0.5?l*(1+s):l+s-l*s;const p=2*l-q;
    const t=[h+1/3,h,h-1/3].map(x=>{if(x<0)x+=1;if(x>1)x-=1;
      if(x<1/6)return p+(q-p)*6*x; if(x<1/2)return q; if(x<2/3)return p+(q-p)*(2/3-x)*6; return p;});
    [r,g,b]=t;}
  return [Math.round(r*255),Math.round(g*255),Math.round(b*255)];
}
// 由 hex 生成「配套颜色」：互补 / 邻近 / 三角
function companionColors(hex){
  const [r,g,b]=hex2rgb(hex); const {h,s,l}=rgb2hsl(r,g,b);
  const mk=(hh,ss,ll)=>{const [rr,gg,bb]=hsl2rgb((hh%360+360)%360,clamp(ss,0,1),clamp(ll,0,1));return rgb2hex(rr,gg,bb);};
  return {
    base:{hex:rgb2hex(r,g,b),h,s,l},
    complementary:mk(h+180,s*0.90,l),
    analogous:[mk(h-30,s*0.95,l),mk(h+30,s*0.95,l)],
    triadic:[mk(h+120,s*0.88,l),mk(h-120,s*0.88,l)],
    split:[mk(h+150,s*0.85,l),mk(h-150,s*0.85,l)],
    light:mk(h,s*0.85,clamp(l+0.22,0.15,0.92)),
    dark:mk(h,s*0.85,clamp(l-0.22,0.08,0.85))
  };
}
// hue → 图库颜色词（对齐代理支持的颜色词：red/orange/yellow/green/teal/blue/purple/pink）
function hueToColorWord(h){
  if(h<15||h>=345) return 'red';
  if(h<45) return 'orange';
  if(h<70) return 'yellow';
  if(h<160) return 'green';
  if(h<200) return 'teal';
  if(h<250) return 'blue';
  if(h<290) return 'purple';
  return 'pink';
}
/* ---------- 配色打分（harmonyScore，v3：双色系统，三大方向都给高分） ----------
   输入 colors: [{h,s,l,hex}]  (h:0-360, s/l:0-1)
   输出 {score:0-100, type:'中文类型', pair:[hex1,hex2]}
   评分维度（只看最优秀的一对颜色）：
     1) 邻近和谐：色相靠近（15°-50°）、温度一致、饱和度协调
     2) 强对比：互补/近互补（120°-180°）、冷暖对冲、明暗分明
     3) 独特创意：角度不常规（50°-100°）但高饱和、有张力
     只要任一项优秀，整体就能拿高分。偏灰暗/刺眼/人物肤色会额外扣分。 */
function scoreTwoColors(a,b){
  const h1=((a.h||0)%360+360)%360, h2=((b.h||0)%360+360)%360;
  const s1=a.s==null?0:a.s, s2=b.s==null?0:b.s;
  const l1=a.l==null?0.5:a.l, l2=b.l==null?0.5:b.l;
  const d=hueDist(h1,h2);
  const avgS=(s1+s2)/2, minS=Math.min(s1,s2);
  const lc=Math.abs(l1-l2);
  const warm = (h1<55||h1>=330)||(h2<55||h2>=330);
  const cool = (h1>=200&&h1<285)||(h2>=200&&h2<285);
  const bothWarm = (h1<55||h1>=330)&&(h2<55||h2>=330);
  const bothCool = (h1>=200&&h1<285)&&(h2>=200&&h2<285);
  const tempCoherent = bothWarm||bothCool||(!warm&&!cool);
  const sameSat = Math.abs(s1-s2)<0.35;

  // 特别分支：中性色 + 强调色（白/灰/黑 + 一个鲜色）— 经典耐看，单独给高分
  if(minS<0.12 && avgS>0.20){
    const accent=s1>s2?a:b;
    const neutral=s1>s2?b:a;
    let nScore=0;
    if(accent.s>0.35){ nScore=72; }                    // 强调色够鲜明
    else if(accent.s>0.20){ nScore=55; }
    if(lc>0.30) nScore+=10;                           // 中性色与强调色有明暗层次
    if(lc>0.55) nScore+=5;
    if(neutral.l>0.85) nScore+=4;                     // 白底/浅底更干净
    if(neutral.l<0.25) nScore+=4;                     // 黑底更高级
    if(accent.s>0.70) nScore-=6;                      // 但太刺眼的鲜色配中性色也会扣分
    return {
      score: Math.max(0, Math.min(100, Math.round(nScore))),
      type: '中性强调',
      pair: [a.hex, b.hex]
    };
  }

  // 1) 邻近和谐：12-55° 最优，峰值 28°
  let hScore=0, hType='邻近和谐';
  if(d>=12&&d<=55){ hScore=95-Math.abs(d-28)*1.35; }
  else if(d<12){ hScore=55-d*3; } // 太近似，降分
  if(hScore>0){
    if(sameSat) hScore+=5;
    if(tempCoherent) hScore+=4;
    if(lc>=0.12&&lc<=0.55) hScore+=4; // 邻近也要有层次
  }

  // 2) 强对比：100-180°，峰值 180°（互补）
  let cScore=0, cType='互补撞色';
  if(d>=140&&d<=180){ cScore=92-Math.abs(d-180)*0.45; cType='互补撞色'; }
  else if(d>=100&&d<140){ cScore=74-Math.abs(d-120)*0.75; cType='强对比'; }
  if(cScore>0){
    if(minS<0.25) cScore-=16; // 一方太灰，对冲不起来
    else if(minS<0.40) cScore-=6;
    if(avgS>0.75) cScore+=4; // 双方都够鲜
    if(lc>=0.25) cScore+=6; // 明暗层次
    if(warm&&cool) cScore+=5; // 冷暖对冲
  }

  // 3) 独特创意：50-100°，不常规但大胆
  let nScore=0, nType='独特创意';
  if(d>=50&&d<=100){
    nScore=72-Math.abs(d-75)*0.65;
    if(minS>0.55) nScore+=10; // 高饱和才敢叫创意
    if(lc>=0.20) nScore+=5;
    if(!bothWarm&&!bothCool&&(warm||cool)) nScore+=3; // 温冷混搭但不互补，更特别
  }

  // 选一个最高的维度作为基础分
  let score=Math.max(hScore,cScore,nScore);
  let type=hScore>=score?hType:(cScore>=score?cType:nType);
  if(score===0) type='普通';

  // 通用修饰：太灰/太刺眼/太闷都扣分
  if(avgS<0.15) score-=18;                // 几乎无彩，闷
  if(minS>0.90&&lc<0.12) score-=10;        // 高饱和却没层次，刺眼/脏
  if(avgS>0.85&&lc<0.08) score-=8;         // 霓虹糊成一团
  if(tempCoherent&&score>0) score+=3;      // 温度统一更舒服
  if(lc>0.45) score+=3;                    // 强烈明暗对比加分

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    type,
    pair: [a.hex, b.hex]
  };
}
// 给定一组颜色，选出最优秀的一对
function bestColorPair(colors){
  if(!colors||colors.length<2) return {score:0, type:'单色', pair:[]};
  if(colors.length===2) return scoreTwoColors(colors[0], colors[1]);
  let best={score:0, type:'单色', pair:[]};
  for(let i=0;i<colors.length;i++){
    for(let j=i+1;j<colors.length;j++){
      const r=scoreTwoColors(colors[i], colors[j]);
      if(r.score>best.score) best=r;
    }
  }
  return best;
}
// 人物检测：优先看描述关键词（比单纯看肤色准），人像图配色参考价值低 → 重扣
const PERSON_RE=/portrait|person|people|human|woman|man|girl|boy|child|kid|model|face|selfie|crowd|family|couple|lady|guy|baby|teenager|bride|groom|student|soldier/i;
function personPenalty(ph, colors){
  const desc=(ph&&(ph.desc||''))||'';
  if(PERSON_RE.test(desc)) return 28;                 // 描述明确有人 → 重扣
  // 描述缺失时兜底：主色像肤色且占比高
  const m=colors&&colors[0];
  if(m&&m.h>10&&m.h<45&&m.s>0.22&&m.s<0.66&&m.l>0.35&&m.l<0.78){
    const total=colors.reduce((a,c)=>a+(c.c||1),0)||1;
    const share=(m.c||1)/total;
    if(share>0.45) return 20;
  }
  return 0;
}
function hasPerson(ph, colors){ return personPenalty(ph, colors)>0; }
function harmonyScore(colors, ph){
  if(!colors||colors.length<2) return {score:0, type:'单色', pair:[]};
  const best=bestColorPair(colors);
  let pen=skinPenalty(colors);
  pen += uncomfortablePenalty(colors);
  pen += personPenalty(ph, colors);   // 有人的图整体压低，尽量不进精选
  best.score=Math.max(0, Math.round(best.score-pen));
  return best;
}
// 肤色惩罚（人像图主色偏肤且占比高 → 配色参考价值低）
function skinPenalty(colors){
  if(!colors||!colors.length) return 0;
  const m=colors[0];
  const skin=m.h>10&&m.h<45&&m.s>0.22&&m.s<0.66&&m.l>0.35&&m.l<0.78;
  const total=colors.reduce((a,c)=>a+(c.c||1),0)||1;
  const share=(m.c||1)/total;
  return (skin&&share>0.45)?18:0;
}
// AI 科技渐变惩罚（紫+蓝+青 高饱和叠一起的"AI 脸"）— 保留但主要作用于多色
function aiGradientPenalty(colors){
  if(!colors||colors.length<3) return 0;
  const ai = colors.filter(c=> c.s>0.45 && ((c.h>=250&&c.h<=320)||(c.h>=190&&c.h<=230)) );
  return ai.length>=3 ? 14 : 0;
}
// 难受/刺眼配色检测（内部惩罚）：高饱和+别扭夹角+低明暗差 → 扣
function uncomfortablePenalty(colors){
  if(!colors||colors.length<2) return 0;
  const pairs=[];
  for(let i=0;i<colors.length;i++) for(let j=i+1;j<colors.length;j++) pairs.push([colors[i],colors[j]]);
  let maxPen=0;
  for(const [a,b] of pairs){
    const d=hueDist(a.h,b.h);
    const s=(a.s+b.s)/2;
    const lc=Math.abs(a.l-b.l);
    // 真正"难受"的是：夹角在尴尬中间区（45-100°），且饱和高、明暗差小，导致"振动/刺眼"
    if(d>=45&&d<100 && s>0.70 && lc<0.30){
      const pen=Math.min(22, 10 + (s-0.70)*20 + (100-d)*0.08);
      if(pen>maxPen) maxPen=pen;
    }
  }
  return maxPen;
}
// 专门找"最难受的一对"，用于单独的"辣眼睛"题材
function findMostUncomfortablePair(colors){
  if(!colors||colors.length<2) return null;
  let worst=null, worstScore=-Infinity;
  const pairs=[];
  for(let i=0;i<colors.length;i++) for(let j=i+1;j<colors.length;j++) pairs.push([colors[i],colors[j]]);
  for(const [a,b] of pairs){
    const d=hueDist(a.h,b.h);
    const s=(a.s+b.s)/2;
    const lc=Math.abs(a.l-b.l);
    // 难受度：只在中等夹角（45-100°）高饱和 + 低明暗差 才成立；真正互补/邻近不算难受
    let ug = 0;
    if(d>=45&&d<100){
      ug += (100-d)*0.7;
      ug += Math.max(0, s-0.5)*40;
      ug += Math.max(0, 0.30-lc)*30;
      if(s>0.6 && lc<0.30) ug += 15;
    }
    if(ug>worstScore){ worstScore=ug; worst={a,b,ug}; }
  }
  if(!worst||worstScore<15) return null;
  return worst;
}
// 给图片打"难受分"：用于单独排名最难受配色
function discomfortScore(colors){
  const p=findMostUncomfortablePair(colors);
  if(!p) return 0;
  return Math.min(100, Math.round(p.ug));
}
// canvas 提色（前端兜底）：用 K-Means 聚类，过滤暗/亮/灰，保证颜色有参考价值
function rgb2lab(r,g,b){
  const toLinear = x => x > 0.04045 ? Math.pow((x+0.055)/1.055, 2.4) : x/12.92;
  const rl=toLinear(r/255), gl=toLinear(g/255), bl=toLinear(b/255);
  const x = rl*0.4124564 + gl*0.3575761 + bl*0.1804375;
  const y = rl*0.2126729 + gl*0.7151522 + bl*0.0721750;
  const z = rl*0.0193339 + gl*0.1191920 + bl*0.9503041;
  const toLab = t => t > 0.008856 ? Math.pow(t,1/3) : (7.787*t + 16/116);
  return {L:116*toLab(y)-16, A:500*(toLab(x)-toLab(y)), B:200*(toLab(y)-toLab(z))};
}
function labDist(c1,c2){ const dL=c1.L-c2.L, dA=c1.A-c2.A, dB=c1.B-c2.B; return Math.sqrt(dL*dL+dA*dA+dB*dB); }

/* 把「精简版」照片数据补全成运行时需要的完整色对象。
   photos.json 里颜色只存 {hex}（省体积），这里一次性把 hsl/rgb/lab/name
   以及裸的 h/s/l 都算出来，避免每个页面重复解析 2MB JSON 拖慢加载。 */
function normalizePhotos(list){
  if(!Array.isArray(list)) return list;
  for(const p of list){
    if(!p) continue;
    // 由缩略图 URL 推导大图 URL（w=400/600/raw → w=1080），不必在 JSON 里重复存
    if(!p.full && p.thumb) p.full = p.thumb.replace(/w=\d+/, 'w=1080');
    if(!p.colors || !p.colors.length) continue;
    const used = [];
    for(const c of p.colors){
      if(!c || !c.hex) continue;
      const rgb = hex2rgb(c.hex);
      const hsl = rgb2hsl(rgb[0], rgb[1], rgb[2]);
      c.rgb = rgb;
      c.hsl = hsl;
      c.lab = rgb2lab(rgb[0], rgb[1], rgb[2]);
      c.h = hsl.h; c.s = hsl.s; c.l = hsl.l;   // 兼容直接用 c.h/c.s/c.l 的旧逻辑
      if(!c.name) c.name = colorName(hsl, used);
      used.push(c.name);
    }
  }
  return list;
}

function loadImage(url){
  return new Promise(res=>{const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>res(img);img.onerror=()=>res(null);img.src=url;});
}
function kmeansInit(pixels, k){
  const centers=[];
  centers.push({...pixels[Math.floor(Math.random()*pixels.length)]});
  while(centers.length < Math.min(k, pixels.length)){
    let total=0; const w=[];
    for(const p of pixels){
      let minD=Infinity;
      for(const c of centers){ const d=(p.r-c.r)**2+(p.g-c.g)**2+(p.b-c.b)**2; if(d<minD)minD=d; }
      total += minD; w.push(minD);
    }
    const target=Math.random()*total; let acc=0, chosen=null;
    for(let i=0;i<pixels.length;i++){ acc += w[i]; if(acc>=target){ chosen=pixels[i]; break; } }
    if(!chosen) chosen=pixels[pixels.length-1];
    centers.push({...chosen});
  }
  return centers;
}
function kmeans(pixels, k=6, maxIter=15){
  if(pixels.length===0) return [];
  const centers=kmeansInit(pixels,k);
  for(let it=0; it<maxIter; it++){
    const clusters=centers.map(()=>[]);
    for(const p of pixels){
      let best=0, bestD=Infinity;
      for(let i=0;i<centers.length;i++){ const d=(p.r-centers[i].r)**2+(p.g-centers[i].g)**2+(p.b-centers[i].b)**2; if(d<bestD){bestD=d; best=i;} }
      clusters[best].push(p);
    }
    let moved=false;
    for(let i=0;i<centers.length;i++){
      const cl=clusters[i]; if(cl.length===0) continue;
      const nr=Math.round(cl.reduce((a,p)=>a+p.r,0)/cl.length), ng=Math.round(cl.reduce((a,p)=>a+p.g,0)/cl.length), nb=Math.round(cl.reduce((a,p)=>a+p.b,0)/cl.length);
      if(nr!==centers[i].r || ng!==centers[i].g || nb!==centers[i].b) moved=true;
      centers[i]={r:nr,g:ng,b:nb};
    }
    if(!moved) break;
  }
  return centers;
}
function extractDominant(img,n=3){
  try{
    const S=40; const cv=document.createElement('canvas'); cv.width=S; cv.height=S;
    const ctx=cv.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0,S,S);
    const data=ctx.getImageData(0,0,S,S).data;
    const pixels=[];
    for(let i=0;i<data.length;i+=4){
      if(data[i+3]<125) continue;
      const r=data[i], g=data[i+1], b=data[i+2];
      const hsl=rgb2hsl(r,g,b);
      if(hsl.l<0.12 || hsl.l>0.88 || hsl.s<0.10) continue;
      pixels.push({r,g,b,hsl});
    }
    if(pixels.length===0) return [];
    const centers=kmeans(pixels,6,15);
    const clusters=centers.map((c,idx)=>{
      let count=0, sumR=0, sumG=0, sumB=0;
      for(const p of pixels){
        let bestD=Infinity, bestC=0;
        for(let i=0;i<centers.length;i++){ const d=(p.r-centers[i].r)**2+(p.g-centers[i].g)**2+(p.b-centers[i].b)**2; if(d<bestD){bestD=d; bestC=i;} }
        if(bestC===idx){ count++; sumR+=p.r; sumG+=p.g; sumB+=p.b; }
      }
      if(count===0) count=1;
      const avgR=Math.round(sumR/count), avgG=Math.round(sumG/count), avgB=Math.round(sumB/count);
      const hsl=rgb2hsl(avgR,avgG,avgB); const lab=rgb2lab(avgR,avgG,avgB);
      const health=(hsl.s*0.5+hsl.l*0.3+(count/pixels.length)*0.2)*(hsl.s>0.15?1:0.3);
      return {r:avgR,g:avgG,b:avgB,hsl,lab,health};
    }).sort((a,b)=>b.health-a.health);

    const out=[];
    for(const c of clusters){
      if(out.length>=n) break;
      if(out.every(o=> labDist(c.lab,o.lab) >= 32)){
        const hex=rgb2hex(c.r,c.g,c.b);
        out.push({hex:hex,rgb:[c.r,c.g,c.b],h:c.hsl.h,s:c.hsl.s,l:c.hsl.l});
      }
    }
    return out;
  }catch(e){ return []; }
}

/* ---------- 调色板生成（保证 3 色彼此明显不同、有参考意义） ---------- */
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function hueNoun(h){
  if(h<15||h>=345) return '赤';
  if(h<45) return '橘';
  if(h<70) return '金';
  if(h<160) return '绿';
  if(h<200) return '青';
  if(h<250) return '蓝';
  if(h<290) return '紫';
  if(h<330) return '粉';
  return '调';
}

/* ---------- 标题配文系统：优先从图片描述提取内容，再结颜色氛围 ---------- */
function deterministicPick(arr, seed){
  if(!arr || !arr.length) return '';
  const s = String(seed || Math.random());
  let h = 0;
  for(let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
  return arr[Math.abs(h)%arr.length];
}

// 内容词：从图片里有什么（主体）
function contentKeywordFromDesc(desc){
  const text = (''+(desc||'')).toLowerCase();
  const map = [
    // —— 第一优先：天气 / 时间 / 氛围（最具画面辨识度，也是“这张图是什么气氛”的关键）——
    {re:/storm|thunder|lightning|tornado|hurricane|dark cloud|dramatic sky|overcast/, w:['风暴','乌云','雷动','云层']},
    {re:/night|midnight|moon|neon|city lights|evening/, w:['夜色','子夜','霓虹']},
    {re:/light|lamp|glow|bulb|lantern|candle|beam|flare|spotlight/, w:['灯影','光晕','光束']},
    {re:/sunset|sunrise|dawn|dusk|twilight|golden hour|silhouette|backlight|afterglow/, w:['日落','日出','剪影','余晖']},
    {re:/sky|cloud|horizon|atmosphere|cumulus|cloudscape/, w:['云际','天空','云层']},
    {re:/rain|wet|rainy|drop|drizzle|pour|shower|puddle|raindrop/, w:['雨幕','湿润','雨滴']},
    {re:/fog|mist|haze|foggy|smoke|steam|vapor/, w:['雾霭','朦胧','雾面']},
    {re:/snow|winter|cold|ice|frost|snowflake|frozen|icy/, w:['雪原','冰川','素白']},
    // —— 第二优先：具体空间 / 赛事 / 主体（天气/氛围不命中时才用）——
    {re:/interior|home|living room|bedroom|kitchen|fireplace|sofa|couch|chair|furniture|decor|house|apartment|cozy|domestic/, w:['居所','室内','空间']},
    {re:/cycling|cyclist|bicycle|bike|mountain bike|road bike|cycle/, w:['骑行','单车','赛道']},
    {re:/race|marathon|running|runner|finish|finish line|competition|sport|athlete|stadium|track|banner|flag/, w:['赛程','终点','山野']},
    // —— 第三优先：自然/城市/静物主体——
    {re:/food|meal|dessert|fruit|drink|coffee|bread|cake|dish|restaurant|kitchen|cafe|tea|beverage/, w:['食光','咖啡','甜点']},
    {re:/sea|ocean|beach|wave|coast|shore|shell|seaside/, w:['海岸','海浪','沙滩']},
    {re:/lake|river|stream|pond|waterfall|reflection|canal|creek/, w:['湖畔','溪流','倒影']},
    {re:/mountain|hill|peak|valley|cliff|rock|stone|canyon|summit|ridge|boulder|alps|alpine/, w:['山脊','山野','峭壁']},
    {re:/desert|sandy|dune|arid/, w:['沙丘','沙漠','沙海']},
    {re:/forest|tree|trunk|branch|leaf|jungle|garden|floral|flower|bloom|foliage|woodland|woods/, w:['林间','树影','花房']},
    {re:/field|meadow|grass|prairie|farm|wheat|crop|pasture/, w:['原野','草地','田野']},
    {re:/animal|dog|cat|bird|wildlife|horse|fish|pet|deer|lion|elephant|wolf|butterfly|insect/, w:['生灵','动物','飞鸟']},
    {re:/portrait|person|people|human|woman|man|girl|boy|child|kid|model|face/, w:['人物','行人','旅人','面孔']},
    {re:/bicycle|bike|cycling|cyclist/, w:['骑行','单车','赛道']},
    {re:/road|street|avenue|highway|alley|sidewalk|crosswalk|intersection/, w:['街角','街道','路口']},
    {re:/city|urban|downtown|skyline|metropolis/, w:['城市','都市','街景']},
    {re:/building|architecture|skyscraper|tower|facade|interior|room|apartment|office/, w:['建筑','楼宇','空间']},
    {re:/bridge|tunnel|viaduct/, w:['桥梁','桥影']},
    {re:/window|door|balcony|corridor|stair|staircase|escalator/, w:['窗景','门廊','阶梯']},
    {re:/car|vehicle|automobile|motorcycle|bus|truck|traffic|parking/, w:['车流','公路','交通']},
    {re:/train|subway|railway|station|platform/, w:['列车','站台','轨道']},
    {re:/airplane|airport|flight|flying|aviation/, w:['飞行','空港','天际']},
    {re:/boat|ship|sail|yacht|harbor|pier|dock|ferry/, w:['舟泊','海港','帆影']},
    {re:/book|page|paper|magazine|newspaper|letter|notebook/, w:['书页','纸间','阅读']},
    {re:/abstract|minimal|minimalism|simple|geometry|pattern|shape|form|design|texture/, w:['形迹','纹理','几何']}
  ];
  for(const item of map){ if(item.re.test(text)) return deterministicPick(item.w, text); }
  return '';
}
// 兼容旧调用
function keywordFromDesc(desc){ return contentKeywordFromDesc(desc); }

// 氛围词：画面整体感觉 / 时间 / 天气
function sceneMoodFromDesc(desc){
  const text = (''+(desc||'')).toLowerCase();
  const map = [
    {re:/storm|thunder|tornado|dark cloud|dramatic sky|heavy cloud/, w:['压境','将至','骤起']},
    {re:/night|midnight|moon|neon|city lights/, w:['夜色','子夜','阑珊']},
    {re:/sunset|dusk|twilight|golden hour/, w:['余晖','暮色','黄昏']},
    {re:/sunrise|dawn|morning/, w:['晨光','黎明','清晨']},
    {re:/rain|wet|rainy|drop|drizzle|pour|shower/, w:['湿润','雨幕','淅沥']},
    {re:/fog|mist|haze|foggy|smoke|steam/, w:['雾霭','朦胧','迷离']},
    {re:/snow|winter|cold|ice|frost|frozen/, w:['雪原','冷光','素白']},
    {re:/noon|daylight|sunny|bright/, w:['正午','晴光','白昼']},
    {re:/calm|peaceful|quiet|serene|still/, w:['静谧','安宁','沉静']},
    {re:/vintage|retro|old|aged|weathered/, w:['旧时光','复古','斑驳']}
  ];
  for(const item of map){ if(item.re.test(text)) return deterministicPick(item.w, text); }
  return '';
}
function moodFromDesc(desc, colors){
  const scene = sceneMoodFromDesc(desc);
  if(scene) return scene;
  if(!colors || !colors[0]) return '薄暮';
  return moodFromColor(colors[0].hsl, desc);
}

// 颜色氛围词：当描述不足时兜底
function moodFromColor(hsl, seed){
  const {h,s,l} = hsl;
  if(l > 0.78) return deterministicPick(['清晨','晨光','正午','暖阳'], seed);
  if(l < 0.25) return deterministicPick(['子夜','暮色','午夜','薄暮'], seed);
  if(s < 0.12) return deterministicPick(['薄暮','雾霭','轻纱','雾面'], seed);
  if(h>=45 && h<75) return deterministicPick(['暖阳','午后','晨光','流金'], seed);
  if(h>=200 && h<260) return deterministicPick(['冷光','晴空','清晨','天光'], seed);
  if(h>=85 && h<160) return deterministicPick(['林间','清晨','薄暮','露台'], seed);
  if(h>=15 && h<45) return deterministicPick(['暖阳','午后','流金','落霞'], seed);
  if((h>=0 && h<15) || h>=330) return deterministicPick(['暖阳','正午','流金','落霞'], seed);
  if(h>=250 && h<290) return deterministicPick(['暮色','花房','薄暮','霓虹'], seed);
  if(h>=290 && h<330) return deterministicPick(['花房','晨光','轻纱','雾霭'], seed);
  if(h>=160 && h<200) return deterministicPick(['冷光','海岸','清晨','青瓷'], seed);
  return deterministicPick(['薄暮','露台','边界','尽头'], seed);
}

// 颜色意象词：无描述时的 fallback
function colorImageWord(hsl, seed){
  const {h,s,l}=hsl;
  if(l<0.12) return deterministicPick(['玄墨','石墨','岩黑','焦炭'], seed);
  if(l>0.90) return deterministicPick(['素白','轻纱','霜白','晨雾'], seed);
  if(s<0.10) return deterministicPick(['轻纱','石墨','雾面','云灰'], seed);
  if(h<15 || h>=345) return deterministicPick(['绯红','绛红','丹','胭脂'], seed);
  if(h<28) return deterministicPick(['赤陶','砖绯','锈红','赭红'], seed);
  if(h<45) return deterministicPick(['橘焰','赤陶','琥珀','杏绯'], seed);
  if(h<52) return deterministicPick(['橘焰','杏绯','琥珀','赤陶'], seed);
  if(h<70) return deterministicPick(['鹅黄','缃色','琥珀','金萱'], seed);
  if(h<95) return deterministicPick(['苔绿','碧色','苍翠','嫩芽'], seed);
  if(h<135) return deterministicPick(['碧色','苍青','竹青','苔绿'], seed);
  if(h<170) return deterministicPick(['青碧','苍翠','湖色','竹青'], seed);
  if(h<200) return deterministicPick(['霜青','湖碧','海雾','青瓷'], seed);
  if(h<225) return deterministicPick(['晴蓝','霁蓝','湖蓝','霜青'], seed);
  if(h<260) return deterministicPick(['靛蓝','克莱因','晴空','湛蓝'], seed);
  if(h<285) return deterministicPick(['紫苑','薰雾','萝紫','靛青'], seed);
  if(h<315) return deterministicPick(['薰紫','紫藤','霞粉','萝紫'], seed);
  if(h<330) return deterministicPick(['霞粉','玫瑰','珊瑚光','雾紫'], seed);
  return deterministicPick(['石墨','轻纱','云灰'], seed);
}

// 综合标题：内容优先，颜色兜底
function paletteTitle(colors, styles, ph){
  if(ph) return aCardTitle(ph);
  if(!colors||!colors.length) return '配色灵感';
  const c=colors[0]; const seed=(c.hex||'')+(colors.map(x=>x.hex).join(''));
  return colorImageWord(c.hsl, seed) + moodFromColor(c.hsl, seed);
}
/* 生成调色板（保证 3 色彼此明显不同，且命名不重复） */
function buildPalette(img){
  try{
    let out=extractDominant(img,3);
    if(out.length>0 && out.length<3){
      const comp=companionColors(out[0].hex);
      const cands=[comp.light,comp.dark,comp.complementary,comp.analogous[0],comp.analogous[1],comp.triadic[0],comp.triadic[1]];
      for(const hex of cands){
        if(out.length>=3) break;
        const [rr,gg,bb]=hex2rgb(hex); const lab=rgb2lab(rr,gg,bb);
        if(out.some(o=> labDist(lab, rgb2lab(...o.rgb)) < 32)) continue;
        const hsl=rgb2hsl(rr,gg,bb); out.push({hex:hex,rgb:[rr,gg,bb],h:hsl.h,s:hsl.s,l:hsl.l});
      }
    }
    while(out.length<3){
      const base=out[0]||{h:0,s:0,l:0.5};
      const L=clamp(base.l+(out.length%2===1?0.18:-0.18),0.15,0.85);
      const [rr,gg,bb]=hsl2rgb(base.h,base.s,L); const hex=rgb2hex(rr,gg,bb); const lab=rgb2lab(rr,gg,bb);
      if(out.some(o=> labDist(lab,rgb2lab(...hex2rgb(o.hex))) < 32)){
        const [rr2,gg2,bb2]=hsl2rgb(base.h+(out.length===1?15:-15),base.s,L); out.push({hex:rgb2hex(rr2,gg2,bb2),rgb:[rr2,gg2,bb2],h:base.h+15,s:base.s,l:L});
      } else { out.push({hex:hex,rgb:[rr,gg,bb],h:base.h,s:base.s,l:L}); }
    }
    const usedNames=[];
    return out.slice(0,3).map(c=>{ const hsl=rgb2hsl(...c.rgb); const name=colorName(hsl,usedNames); usedNames.push(name); return {...c,hsl,name,h:hsl.h,s:hsl.s,l:hsl.l}; });
  }catch(e){ return []; }
}
// 计算两个调色板（各3色）的整体感知距离。基于 CIELAB，主色权重更高。
function paletteDistance(a, b){
  if(!a || !b || a.length===0 || b.length===0) return Infinity;
  const labsA = a.map(c=> rgb2lab(...(c.rgb || hex2rgb(c.hex))));
  const labsB = b.map(c=> rgb2lab(...(c.rgb || hex2rgb(c.hex))));
  let total=0, wsum=0;
  const weights = [0.5, 0.3, 0.2]; // 主色、次色、第三色
  labsA.forEach((la, i)=>{
    const w = weights[i] || 0.2;
    const minD = Math.min(...labsB.map(lb=> labDist(la, lb)));
    total += minD * w; wsum += w;
  });
  return wsum>0 ? total/wsum : Infinity;
}
// 找与目标照片整体色调最接近的 N 张照片（从 photos.json 池子里选）
function findSimilarByPalette(all, target, n=15){
  if(!target || !target.colors) return [];
  const candidates = (all||[]).filter(p=> p.id !== target.id && p.colors && p.colors.length>=2);
  return candidates.map(p=>{
    // 整组调色板的感知距离（主色权重 0.5 / 次色 0.3 / 第三色 0.2），这是“同风格”的主依据
    const d = paletteDistance(target.colors, p.colors);
    // 同主题仅作“微调”：描述里共享的实义词越多，越靠前，但上限很小，确保仍以整体配色为主
    let bonus=0;
    if(target.desc && p.desc){
      const a = new Set((target.desc.toLowerCase().match(/[a-z]{4,}/g)||[]));
      const b = new Set((p.desc.toLowerCase().match(/[a-z]{4,}/g)||[]));
      let shared=0; a.forEach(w=>{ if(b.has(w)) shared++; });
      if(shared>0) bonus = Math.min(shared, 4) * 2; // 最多减 8
    }
    return {p, score: d - bonus};
  }).sort((a,b)=>a.score-b.score).slice(0,n).map(x=>x.p);
}
function matchStyles(colors){
  if(!window.STYLE_TAGS) return [];
  return window.STYLE_TAGS.filter(t=>{try{return t.match(colors);}catch(e){return false;}})
    .map(t=>({id:t.id,name:t.name,emoji:t.emoji,desc:t.desc,hint:t.hint}));
}

/* ---------- 收藏（localStorage） ---------- */
const LS_LIKES='picseek_likes_v1';
function getLikes(){ try{return JSON.parse(localStorage.getItem(LS_LIKES)||'[]');}catch(e){return [];} }
function isLiked(id){ return getLikes().some(x=>x.id===id); }
function addLike(ph){
  const arr=getLikes();
  if(arr.some(x=>x.id===ph.id)) return false;
  arr.push({id:ph.id,source:ph.source,thumb:ph.thumb,full:ph.full,
    photographer:ph.photographer,photographerLink:ph.photographerLink,pageLink:ph.pageLink,
    downloadLocation:ph.downloadLocation,desc:(ph.desc||''),colors:(ph.colors||null),
    likedAt:Date.now()});
  localStorage.setItem(LS_LIKES,JSON.stringify(arr));
  return true;
}
function removeLike(id){
  const arr=getLikes().filter(x=>x.id!==id);
  localStorage.setItem(LS_LIKES,JSON.stringify(arr));
}
function toggleLike(ph){
  if(isLiked(ph.id)){removeLike(ph.id);return false;}
  addLike(ph);return true;
}

/* ---------- 影集自动识别分层（多标签：一张图可归属多个分类） ---------- */
// 分类种子词（中英文都覆盖）。顺序即展示顺序。
const CAT_SEEDS = {
  '人物':['portrait','people','woman','man','girl','boy','face','person','model','人像','人物','女孩','男孩','模特','儿童'],
  '动物':['animal','dog','cat','bird','wildlife','horse','fish','宠物','动物','猫','狗','鸟','野生动物'],
  '美食':['food','coffee','meal','dessert','fruit','drink','美食','咖啡','甜点','水果','餐饮','饮品'],
  '植物花卉':['flower','plant','bloom','botanical','leaf','花','植物','花卉','绿植','树叶'],
  '海洋':['ocean','sea','wave','beach','water','海浪','海滩','海洋','冲浪'],
  '汽车交通':['car','vehicle','automobile','bike','motorcycle','汽车','车','摩托','自行车'],
  '运动':['sport','fitness','running','yoga','运动','健身','跑步','瑜伽'],
  '天空云':['sky','cloud','cloudy','sunrise','sunset','朝霞','晚霞','云','天空','日出','日落','彩霞'],
  '星空夜景':['star','stars','galaxy','milky','aurora','night','night sky','星空','星','银河','极光','夜景','夜晚','灯火'],
  '城市建筑':['building','architecture','architect','city','urban','facade','bridge','street','城市','建筑','桥梁','街拍','室内','楼宇','天台'],
  '风景自然':['landscape','nature','mountain','forest','lake','river','desert','tree','草原','森林','海','湖','山','自然','风景','溪流','雪原'],
  '产品静物':['product','object','still life','gadget','device','静物','产品','商品','数码','物件'],
  '抽象极简':['abstract','texture','pattern','geometric','minimal','minimalism','抽象','纹理','几何','图案','极简','留白','简约'],
};
const CAT_ORDER=['人物','动物','美食','植物花卉','海洋','汽车交通','运动','天空云','星空夜景','城市建筑','风景自然','产品静物','抽象极简'];
// 多标签：一张图可命中多个分类
function classifyMulti(desc, colors){
  const text=(''+(desc||'')).toLowerCase();
  const hits=CAT_ORDER.filter(cat=>CAT_SEEDS[cat].some(k=>text.includes(k.toLowerCase())));
  if(hits.length===0 && colors && colors.length){
    const c=colors[0];
    if(c.l<0.28 && c.h>=200 && c.h<260) hits.push('星空夜景');
    else if(c.h>=200&&c.h<260) hits.push('天空云');
    else if(c.h>=90&&c.h<160 && c.l>0.4) hits.push('风景自然');
    else if(c.s<0.15) hits.push('城市建筑');
    else hits.push('风景自然');
  }
  if(hits.length===0) hits.push('其他');
  return hits;
}
// 兼容旧调用：返回首个命中分类
function classify(desc, colors){ const r=classifyMulti(desc,colors); return r[0]; }
const CAT_LABEL={'人物':'人物','动物':'动物','美食':'美食','植物花卉':'植物花卉','海洋':'海洋','汽车交通':'汽车交通','运动':'运动','天空云':'天空云','星空夜景':'星空夜景','城市建筑':'城市建筑','风景自然':'风景自然','产品静物':'产品静物','抽象极简':'抽象极简','其他':'其他'};

/* ---------- 小工具 ---------- */
function toast(msg){
  let t=document.getElementById('toast');
  if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t);}
  t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2200);
}
// 下载统计（Unsplash 必须触发 download 端点，由服务端代理带 Key）
async function trackDownload(ph){
  if(ph.source==='unsplash'){
    try{const p=new URLSearchParams();if(ph.id)p.set('id',ph.id);if(ph.downloadLocation)p.set('url',ph.downloadLocation);
      await fetch(`${API_BASE}/api/unsplash/download?${p}`);}catch(e){}
  }
  const a=document.createElement('a');a.href=ph.full;a.target='_blank';a.download=(ph.id||'pic')+'.jpg';
  document.body.appendChild(a);a.click();a.remove();
}
// 生成照片卡片 HTML（通用，搜图/影集/风光照都用）
function photoCardHTML(ph, i, opts){
  opts=opts||{};
  const attr = ph.source==='unsplash'?`on <a href="https://unsplash.com/?utm_source=PicSeek" target="_blank" rel="noopener">Unsplash</a>`
    : ph.source==='pexels'?`on <a href="https://pexels.com" target="_blank" rel="noopener">Pexels</a>`
    : ph.source==='pixabay'?`on <a href="https://pixabay.com" target="_blank" rel="noopener">Pixabay</a>`
    : ph.source==='wikimedia'?`from <a href="${ph.pageLink}" target="_blank" rel="noopener">Wikimedia</a>`
    : `from <a href="${ph.pageLink}" target="_blank" rel="noopener">Bing</a>`;
  const likeBtn = opts.noLike? '' :
    `<button class="like ${isLiked(ph.id)?'on':''}" data-like="${ph.id}" title="收藏">${isLiked(ph.id)?'♥':'♡'}</button>`;
  const tag = opts.tag? `<div class="tag">${opts.tag}</div>`:'';
  return `<div class="pcard" data-i="${i}">
    <img loading="lazy" decoding="async" src="${ph.thumb}" alt="${(ph.photographer||'').replace(/"/g,'')}"/>
    ${tag}${likeBtn}
    <div class="ph">${ph.photographer||'未知'} ${attr}<br/><a href="${ph.pageLink}" target="_blank" rel="noopener">查看原图 ↗</a></div>
  </div>`;
}

/* ---------- 详情弹窗（通用，单例） ---------- */
function ensureMask(){
  if(document.getElementById('detailMask')) return document.getElementById('detailMask');
  const m=document.createElement('div'); m.className='mask'; m.id='detailMask';
  m.innerHTML=`<div class="modal"><span class="close" id="closeDetail">×</span>
    <img id="dImg" class="detail-img"/><div id="dAttr" style="font-size:13px;line-height:1.8"></div>
    <button id="dDownload" style="width:100%;margin-top:12px">保存图片（触发来源下载统计）</button>
    <button id="dLike" class="ghost" style="width:100%;margin-top:10px">❤ 收藏到影集</button></div>`;
  document.body.appendChild(m);
  m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show');});
  document.getElementById('closeDetail').onclick=()=>m.classList.remove('show');
  return m;
}
function openDetail(ph){
  const mask=ensureMask();
  mask.querySelector('#dImg').src=ph.full||ph.thumb;
  mask.querySelector('#dAttr').innerHTML =
    `${ph.photographer||'未知'} · ${ph.source==='unsplash'?'Unsplash':ph.source==='pexels'?'Pexels':ph.source}<br/>`+
    `<a href="${ph.pageLink}" target="_blank" rel="noopener">在来源网站查看 ↗</a>`;
  mask.querySelector('#dDownload').onclick=()=>trackDownload(ph);
  const likeBtn=mask.querySelector('#dLike');
  likeBtn.textContent = isLiked(ph.id)?'♥ 已收藏':'❤ 收藏到影集';
  likeBtn.onclick=()=>{
    if(toggleLike(ph)){toast('已收藏到影集');likeBtn.textContent='♥ 已收藏';}
    else{toast('已取消收藏');likeBtn.textContent='❤ 收藏到影集';}
    refreshLikeButtons();
  };
  mask.classList.add('show');
}
// 刷新页面上所有收藏按钮状态
function refreshLikeButtons(){
  document.querySelectorAll('[data-like]').forEach(b=>{
    const on=isLiked(b.dataset.like); b.classList.toggle('on',on); b.textContent=on?'♥':'♡';
  });
}
// 渲染照片网格（通用），并绑定点击详情 / 收藏
function renderGrid(gridEl, list){
  gridEl.innerHTML = list.map((p,i)=>photoCardHTML(p,i)).join('');
  gridEl.querySelectorAll('.pcard').forEach(card=>{
    const p = list[+card.dataset.i];
    if(!p) return;
    card.addEventListener('click', e=>{
      if(e.target.closest('[data-like]')) return;
      openDetail(p);
    });
    const lb=card.querySelector('[data-like]');
    if(lb) lb.addEventListener('click', ev=>{
      ev.stopPropagation();
      if(toggleLike(p)){toast('已收藏到影集');lb.classList.add('on');lb.textContent='♥';}
      else{toast('已取消收藏');lb.classList.remove('on');lb.textContent='♡';}
      refreshLikeButtons();
    });
  });
  if(window.initReveal) window.initReveal();
}

/* ---------- A/B 色卡组件（供首页/色彩页复用） ---------- */
// 综合标题：内容优先，颜色兜底
function aCardTitle(ph){ return poeticTitle(ph); }
function colorName(hsl, usedNames){
  const {h,s,l}=hsl;
  usedNames = usedNames || [];

  // 1. 无彩色（黑/白/灰）：按明度细分层级，从深到浅，避免同图重复
  if(s < 0.06){
    const names = [];
    if(l < 0.15) names.push('玄墨');
    else if(l < 0.28) names.push('石墨');
    else if(l < 0.42) names.push('雾岩');
    else if(l < 0.58) names.push('银霜');
    else if(l < 0.75) names.push('云灰');
    else names.push('素白');
    for(const n of names){ if(!usedNames.includes(n)) return n; }
    if(l < 0.25) return '浓墨';
    if(l > 0.78) return '霜白';
    return (l > 0.5 ? '浅' : '深') + names[0];
  }

  // 2. 极低饱和：米色/灰调意象，不强行按色相叫鲜艳名
  if(s < 0.18){
    const base = [];
    if(h>=30 && h<70) base.push('缃色','奶杏','燕麦');
    else if(h>=70 && h<150) base.push('雾绿','薄荷','苔痕');
    else if(h>=150 && h<190) base.push('霜青','海雾','青瓷');
    else if(h>=190 && h<240) base.push('霁蓝','晴雾','湖蓝');
    else if(h>=240 && h<300) base.push('雾紫','烟萝','薰雾');
    else if(h>=300 && h<340) base.push('藕色','霞粉','雾紫');
    else base.push('麻灰','燕麦','云灰');
    for(const n of base){ if(!usedNames.includes(n)) return n; }
    return (l > 0.55 ? '浅' : '深') + base[0];
  }

  // 3. 棕土家族：最容易误叫鲜艳名的暖浊色，单独处理
  // 橘焰必须鲜亮（s≥0.55 且 l>0.50），否则按饱和/明度落到砂金/赤陶/赭石
  if(h >= 15 && h < 55 && s < 0.55){
    // 浅暖调（米黄、砂金感）
    if(l > 0.50 && s < 0.40){
      const names = ['砂金','燕麦','麻灰','缃色'];
      for(const n of names){ if(!usedNames.includes(n)) return n; }
      return (l > 0.75 ? '浅' : '深') + '砂金';
    }
    // 中浅暖棕（偏亮的棕黄）
    if(l > 0.50 && s >= 0.40 && s < 0.55){
      const names = ['杏檀','砂金','赤陶','燕麦'];
      for(const n of names){ if(!usedNames.includes(n)) return n; }
      return (l > 0.60 ? '浅' : '深') + '杏檀';
    }
    // 中深棕色
    if(l >= 0.25 && l <= 0.50){
      const names = ['赤陶','杏檀','砂金','赭石'];
      for(const n of names){ if(!usedNames.includes(n)) return n; }
      return (l > 0.38 ? '浅' : '深') + '赤陶';
    }
    // 深赭/乌木
    if(l < 0.25){
      const names = ['赭石','深赭','赤陶','玄墨'];
      for(const n of names){ if(!usedNames.includes(n)) return n; }
      return (l > 0.15 ? '深' : '浓') + '赭石';
    }
  }

  // 4. 低饱和但偏浅：奶油/海盐/薄荷等柔和名（同样要走 usedNames 去重，避免同图重复）
  if(s < 0.35 && l > 0.68){
    let soft='';
    if(h>=30 && h<70) soft='奶杏';
    else if(h>=70 && h<150) soft='薄荷';
    else if(h>=150 && h<200) soft='霜青';
    else if(h>=200 && h<260) soft='霁蓝';
    else if(h>=260 && h<300) soft='薰雾';
    else if(h>=300 && h<340) soft='霞粉';
    else if((h>=0 && h<20) || h>=340) soft='珊瑚光';
    if(soft){
      if(!usedNames.includes(soft)) return soft;
      return (l > 0.55 ? '浅' : '深') + soft;   // 同图第二块同色相时加前缀区分
    }
    // 没命中柔和名（如 h 15~30 的暖色）继续走下面的有彩色逻辑
  }

  // 5. 有彩色主体：按色相 + 明度/饱和度 细分
  const base = [];
  if((h>=0 && h<12) || h>=348){ base.push('绯红','绛红','丹','酒绛'); }
  else if(h>=12 && h<20){ base.push('赤陶','砖绯','锈红','赭红'); }
  else if(h>=20 && h<35){ base.push('橘焰','杏绯','赤陶','砖绯'); }
  else if(h>=35 && h<46){ base.push('橘焰','琥珀','杏绯','赤陶'); }
  else if(h>=46 && h<55){ base.push('鹅黄','缃色','琥珀','奶杏'); }
  else if(h>=55 && h<70){ base.push('缃绿','嫩芽','金萱','苔绿'); }
  else if(h>=70 && h<85){ base.push('苔绿','碧色','苍翠','嫩芽'); }
  else if(h>=85 && h<110){ base.push('碧色','苍青','竹青','苔绿'); }
  else if(h>=110 && h<135){ base.push('苍翠','竹青','碧色','青碧'); }
  else if(h>=135 && h<160){ base.push('青碧','苍翠','湖色','竹青'); }
  else if(h>=160 && h<185){ base.push('霜青','湖碧','青瓷','海雾'); }
  else if(h>=185 && h<200){ base.push('霁青','霜青','海雾','湖碧'); }
  else if(h>=200 && h<215){ base.push('晴蓝','霁蓝','湖蓝','霜青'); }
  else if(h>=215 && h<240){ base.push('湛蓝','晴蓝','深蓝','湖蓝'); }
  else if(h>=240 && h<260){ base.push('靛蓝','克莱因','晴蓝','湛蓝'); }
  else if(h>=260 && h<275){ base.push('萝紫','靛青','晴蓝','霁蓝'); }
  else if(h>=275 && h<290){ base.push('紫苑','薰雾','萝紫','靛青'); }
  else if(h>=290 && h<305){ base.push('薰紫','紫藤','霞粉','萝紫'); }
  else if(h>=305 && h<325){ base.push('霞粉','玫瑰','珊瑚光','糖渍'); }
  else if(h>=325 && h<340){ base.push('绯红','霞粉','玫瑰','珊瑚光'); }
  else { base.push('雾灰','银霜','云灰'); }

  let chosen = base[0];
  if(s > 0.80 && base.includes('克莱因')) chosen = '克莱因';
  else if(s > 0.80 && base.includes('绯红')) chosen = '绯红';
  else if(l < 0.25 && base.includes('酒绛')) chosen = '酒绛';
  else if(l < 0.30 && base.includes('深蓝')) chosen = '深蓝';
  else if(l > 0.75 && base.includes('霞粉')) chosen = '霞粉';
  else if(l > 0.75 && base.includes('薄荷')) chosen = '薄荷';
  else if(l > 0.75 && base.includes('晴蓝')) chosen = '晴蓝';
  else if(l > 0.75 && base.includes('霁蓝')) chosen = '霁蓝';
  else if(base.includes('橘焰') && l > 0.50 && s > 0.55) chosen = '橘焰';
  else if(base.includes('杏绯') && l > 0.55 && s > 0.40) chosen = '杏绯';
  else if(base.includes('赤陶') && s > 0.55) chosen = '赤陶';
  else if(base.includes('奶杏') && l > 0.80) chosen = '奶杏';
  else if(base.includes('缃色') && l > 0.80) chosen = '缃色';

  if(!usedNames.includes(chosen)) return chosen;
  for(const b of base){ if(!usedNames.includes(b)) return b; }
  return (l > 0.55 ? '浅' : '深') + chosen;
}
// 艺术化「基色词」：给任一色相一个最简 2 字诗意名（不进 usedNames，永远 2 字，方便拼 4 字标题）
function artBase(hsl){
  if(!hsl) return '素白';
  const {h,s,l}=hsl;
  if(s<0.06){ if(l<0.15)return'玄墨'; if(l<0.42)return'雾岩'; if(l<0.75)return'云灰'; return'素白'; }
  if(s<0.18){ if(h>=190&&h<260)return'霁蓝'; if(h>=260)return'雾紫'; if(h>=70&&h<160)return'苔痕'; if(h>=30&&h<70)return'缃色'; return'麻灰'; }
  if(h>=15&&h<55&&s<0.55){ return l>0.5?'砂金':(l>=0.25?'赤陶':'赭石'); }
  if((h>=0&&h<12)||h>=348)return'绯红';
  if(h<20)return'赤陶';
  if(h<35)return'橘焰';
  if(h<46)return'琥珀';
  if(h<55)return'鹅黄';
  if(h<70)return'缃绿';
  if(h<110)return'碧色';
  if(h<160)return'苍翠';
  if(h<185)return'霜青';
  if(h<200)return'霁青';
  if(h<240)return'湛蓝';
  if(h<260)return'靛蓝';
  if(h<290)return'紫苑';
  if(h<325)return'霞粉';
  if(h<340)return'绯红';
  return'云灰';
}
// 四字诗意标题：主色基色词（2 字）+ 场景/内容/氛围词（2 字）→ 准确又有艺术感
function poeticTitle(ph){
  if(!ph) return '配色灵感';
  const colors = ph.colors || [];
  const dom = colors[0];
  const base = dom ? artBase(dom.hsl || dom) : '';
  const desc = ph.desc || '';
  const scene = sceneMoodFromDesc(desc);
  const content = contentKeywordFromDesc(desc);
  if(base && scene && scene !== base) return base + scene;   // 湛蓝余晖
  if(base && content && content !== base) return base + content; // 湛蓝海岸
  if(base){
    const mood = moodFromColor(dom.hsl || dom, (ph.id||'') + base);
    return base + mood; // 湛蓝晨光
  }
  return '配色灵感';
}
// WCAG 对比度 → 压在该颜色上的文字该用黑还是白（取对比度更高者，保证清晰可读）
function textOn(hex){
  const [r,g,b]=hex2rgb(hex);
  const lin=x=>{x/=255; return x>0.03928?Math.pow((x+0.055)/1.055,2.4):x/12.92;};
  const L=0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  const cr=(hi,lo)=>(hi+0.05)/(lo+0.05);
  const cWhite=cr(1.0,L), cBlack=cr(L,0.0);
  return cWhite >= cBlack ? '#ffffff' : '#1a1a1a';
}
// 双色组合文案：主色名 × 辅色名 · 类型（效果），让人一眼看懂"哪两个色搭、搭出什么感觉"
function pairCaption(res, pool){
  if(!res || !res.pair || res.pair.length!==2) return '';
  const [h1,h2]=res.pair;
  const c1=pool.find(c=>c.hex===h1)||pool[0];
  const c2=pool.find(c=>c.hex===h2)||pool[1];
  if(!c1||!c2) return '';
  const n1=colorName(c1.hsl||c1);
  const n2=colorName(c2.hsl||c2);
  return `${n1} × ${n2} · ${res.type||''}`;
}
function renderACardHTML(ph, colors, opts){
  opts=opts||{};
  const title=opts.title||aCardTitle(ph);
  const sub=opts.sub||'COLOR PAIR';
  const info=opts.info||`Photo by ${ph.photographer||'未知'}`;
  const pool=(colors&&colors.length)?colors:(ph.colors||[]);
  // A 卡只展示图片里「最优秀的一对」颜色：和谐 / 强对比 / 独特创意  whichever。
  let pairRes={score:0, pair:[]};
  if(pool.length>=2) pairRes=bestColorPair(pool);
  let swObjs=[];
  if(pairRes.pair.length===2){
    const [hex1,hex2]=pairRes.pair;
    const c1=pool.find(c=>c.hex===hex1)||pool[0];
    const c2=pool.find(c=>c.hex===hex2)||pool[1];
    swObjs=[
      {hex:c1.hex,name:colorName(c1.hsl||c1),role:'主色'},
      {hex:c2.hex,name:colorName(c2.hsl||c2),role:pairRes.type||'辅色'}
    ];
  } else if(pool.length>=2){
    swObjs=pool.slice(0,2).map((c,i)=>({hex:c.hex,name:colorName(c.hsl||c),role:i===0?'主色':'辅色'}));
  }
  if(swObjs.length<2 && pool[0]){
    const comp=companionColors(pool[0].hex).complementary;
    const [cr,cg,cb]=hex2rgb(comp); const chsl=rgb2hsl(cr,cg,cb);
    swObjs.push({hex:comp,name:colorName(chsl),role:'搭配'});
  }
  const cap = (pairRes.pair.length===2) ? pairCaption(pairRes, pool) : '';
  const sws=swObjs.map(c=>`<div class="a-sw" data-hex="${c.hex}">
    <div class="a-dot" style="background:${c.hex}"></div>
    <div><div class="a-hex">${c.hex}</div><div class="a-name">${c.name}</div>${c.role?`<span class="a-role">${c.role}</span>`:''}</div>
  </div>`).join('');
  return `<div class="a-card" data-id="${ph.id}">
    <div class="a-img"><img loading="lazy" decoding="async" src="${ph.thumb}" crossorigin="anonymous" alt=""/></div>
    <div class="a-overlay">
      <div class="a-top"><div class="a-title">${title}</div><div class="a-sub">${sub}</div></div>
      <div class="a-bottom" style="display:flex;justify-content:space-between;align-items:flex-end">
        <div class="a-info">${info}</div>
        <div class="a-sws">${sws}${cap?`<div class="a-cap">${cap}</div>`:''}</div>
      </div>
    </div>
  </div>`;
}

// ===== 画廊渲染（高分榜 top / 奇特榜 odd），独立页与「色彩」页 tab 共用 =====
function galleryCardHTML(it, n){
  const {p,res,score,cap,kind}=it;
  const [h1,h2]=res.pair;
  const scoreLabel = kind==='odd' ? `奇特 ${score}` : `${score} 分`;
  return `<div class="gcard">
    <a class="gimg" href="${p.full||p.thumb}" target="_blank" rel="noopener"><img loading="lazy" decoding="async" src="${p.thumb}" alt=""></a>
    <div class="gbody">
      <div class="grow"><span class="grank">#${n}</span><span class="gscore ${kind==='odd'?'gscore-odd':''}">${scoreLabel}</span></div>
      <span class="gtype">${res.type}</span>
      <div class="gsw"><span style="background:${h1}"></span><span style="background:${h2}"></span></div>
      <div class="gcap">${cap}</div>
      <div class="gby">${p.photographer||'未知'}</div>
    </div></div>`;
}
async function renderGalleryInto(container, mode){
  if(!container) return;
  container.innerHTML='<div class="spinner"></div>';
  try{
    const j=await loadPhotosData();
    const list=j.results||[];
    if(typeof normalizePhotos==='function') normalizePhotos(list);

    if(mode==='odd'){
      const items=[];
      for(const p of list){
        const cols=p.colors; if(!cols||cols.length<2) continue;
        if(hasPerson(p,cols)) continue;                       // 不上人物
        const ug=findMostUncomfortablePair(cols); if(!ug) continue;
        const score=Math.round(discomfortScore(cols));
        const res={pair:[ug.a.hex, ug.b.hex], type:'奇特色'};
        items.push({p,res,score,cap:pairCaption(res,cols),kind:'odd'});
      }
      items.sort((a,b)=>b.score-a.score);
      const top=items.slice(0,30);
      container.innerHTML = top.length? top.map((it,i)=>galleryCardHTML(it,i+1)).join('')
                                      : '<div class="empty"><h3>暂无奇特色</h3><p>换个图库再来看</p></div>';
    } else {
      const items=[];
      for(const p of list){
        const cols=p.colors; if(!cols||cols.length<2) continue;
        if(hasPerson(p,cols)) continue;                       // 不上人物
        const res=bestColorPair(cols);
        const pen=skinPenalty(cols)+uncomfortablePenalty(cols);
        const score=Math.max(0,Math.round(res.score-pen));
        if(score<=0) continue;
        items.push({p,res,score,cap:pairCaption(res,cols),kind:'top'});
      }
      items.sort((a,b)=>b.score-a.score);
      // 保证上榜类型多样：每种配色思路都留名额，避免清一色"邻近和谐"
      const QUOTA={'邻近和谐':10,'互补撞色':7,'中性强调':6,'独特创意':4,'强对比':3};
      const byType={}; Object.keys(QUOTA).forEach(t=>byType[t]=items.filter(x=>x.res.type===t));
      const top=[];
      Object.keys(QUOTA).forEach(t=>{ top.push(...byType[t].slice(0, QUOTA[t])); });
      container.innerHTML = top.length? top.map((it,i)=>galleryCardHTML(it,i+1)).join('')
                                      : '<div class="empty"><h3>暂无可展示的配色</h3><p>换个图库再来看</p></div>';
    }
  }catch(e){
    console.error(e);
    container.innerHTML='<div class="empty"><h3>加载失败</h3><p>请确认与本页同目录下有 photos.json</p></div>';
  }
}

// 参考图式横向色卡：左图 + 标题 + 右下三张竖向色卡（色彩页用）
function renderColorSlideHTML(ph, colors, opts){
  opts=opts||{};
  const title=opts.title||paletteTitle(colors, opts.styles, ph)||aCardTitle(ph);
  const sub=opts.sub||'COLOR PALETTE';
  const info=opts.info||`Photo by ${ph.photographer||'未知'}`;
  const cards=(colors||[]).slice(0,3).map((c,i)=>renderColorCardHTML(c,i)).join('');
  return `<div class="color-slide" data-id="${ph.id}">
    <div class="cs-img"><img loading="lazy" decoding="async" src="${ph.thumb}" crossorigin="anonymous" alt=""/></div>
    <div class="cs-body">
      <div class="cs-top">
        <div class="cs-sub">${sub}</div>
        <div class="cs-title">${title}</div>
        <div class="cs-info">${info}</div>
      </div>
      <div class="cs-sws">${cards}</div>
    </div>
  </div>`;
}

function colorCode(i,c){
  // 生成类似设计系统的色卡编号，如 TONE 01
  return `TONE ${String(i+1).padStart(2,'0')}`;
}
function renderColorCardHTML(c, i, opts){
  opts=opts||{};
  const code=opts.code || colorCode(i,c);
  const name=opts.name || (c.hsl?colorName(c.hsl):colorName(c));
  return `<div class="color-card" data-hex="${c.hex}">
    <div class="color-card-swatch" style="background:${c.hex}"></div>
    <div class="color-card-meta">
      <div class="color-card-code">${code}</div>
      <div class="color-card-name">${name}</div>
      <div class="color-card-hex">${c.hex.toUpperCase()}</div>
    </div>
  </div>`;
}
function renderColorChipsHTML(list){
  return `<div class="color-cards">${list.map((c,i)=>renderColorCardHTML(c,i,{code:c.code,name:c.name||c.label})).join('')}</div>`;
}
function ensureColorMask(){
  if(document.getElementById('colorMask')) return document.getElementById('colorMask');
  const m=document.createElement('div'); m.className='mask color-modal'; m.id='colorMask';
  m.innerHTML=`<div class="modal b-detail" style="position:relative"><span class="close" id="closeColor" style="position:absolute;top:10px;right:16px;z-index:5;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.4);font-size:22px;cursor:pointer">×</span>
    <div class="b-img" id="cImgWrap" style="cursor:pointer"><img id="cImg" decoding="async"/></div>
    <div class="b-body">
      <div class="b-title" id="cTitle"></div>
      <div class="b-sub" id="cSub"></div>
      <div class="b-tags" id="cTags"></div>
      <div class="b-sws" id="cSws"></div>
      <div id="cComp" style="margin-top:14px"></div>
    </div>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click',e=>{if(e.target===m) m.classList.remove('show');});
  document.getElementById('closeColor').onclick=()=>m.classList.remove('show');
  return m;
}
function openColorDetail(ph, colors, styles){
  const m=ensureColorMask();
  const title=aCardTitle(ph);
  m.querySelector('#cImg').src=ph.full||ph.thumb;
  m.querySelector('#cImgWrap').onclick=()=>openDetail(ph);
  m.querySelector('#cTitle').textContent=title;
  m.querySelector('#cSub').textContent=`Photo by ${ph.photographer||'未知'} · ${ph.source||'图库'}`;
  m.querySelector('#cTags').innerHTML=(styles||[]).slice(0,5).map(s=>`<span class="b-tag" data-sid="${s.id}">#${s.name}</span>`).join('');
  m.querySelector('#cSws').innerHTML=(colors||[]).slice(0,2).map((c,i)=>renderColorCardHTML(c,i)).join('');
  m.querySelectorAll('#cSws .color-card').forEach(el=>{
    el.onclick=()=>{
      const q=hueToColorWord(rgb2hsl(...hex2rgb(el.dataset.hex)).h);
      location.href=`search.html?q=${encodeURIComponent(q)}&color=${encodeURIComponent(q)}`;
    };
  });
  m.querySelectorAll('#cTags .b-tag').forEach(el=>{
    el.onclick=()=>location.href=`color.html#master-${el.dataset.sid}`;
  });
  m.querySelector('#cComp').innerHTML='';
  if(colors && colors[0]){
    const comp=companionColors(colors[0].hex);
    const items=[
      {hex:comp.complementary, name:colorName(rgb2hsl(...hex2rgb(comp.complementary)))},
      {hex:comp.analogous[0], name:colorName(rgb2hsl(...hex2rgb(comp.analogous[0])))},
      {hex:comp.analogous[1], name:colorName(rgb2hsl(...hex2rgb(comp.analogous[1])))},
      {hex:comp.triadic[0], name:colorName(rgb2hsl(...hex2rgb(comp.triadic[0])))},
      {hex:comp.triadic[1], name:colorName(rgb2hsl(...hex2rgb(comp.triadic[1])))}
    ];
    m.querySelector('#cComp').innerHTML=`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">配套颜色 · 点击可搜同色系图</div>`+renderColorChipsHTML(items);
    m.querySelectorAll('#cComp .color-card').forEach(el=>{
      el.onclick=()=>{
        const q=hueToColorWord(rgb2hsl(...hex2rgb(el.dataset.hex)).h);
        location.href=`search.html?q=${encodeURIComponent(q)}&color=${encodeURIComponent(q)}`;
      };
    });
  }
  m.classList.add('show');
}
function bindACards(container, map){
  container.querySelectorAll('.a-card').forEach(card=>{
    const data=map[card.dataset.id];
    card.onclick=()=>{
      if(!data) return;
      try{ sessionStorage.setItem('picseek_detail_'+data.ph.id, JSON.stringify({ph:data.ph, colors:data.colors, styles:data.styles})); }catch(e){}
      location.href='color-detail.html?id='+encodeURIComponent(data.ph.id);
    };
  });
}

/* ---------- 艺术感：滚动入场动效 ---------- */
(function(){
  document.documentElement.classList.add('js');
  function initReveal(){
    const els=document.querySelectorAll('.reveal:not(.in)');
    if(!('IntersectionObserver' in window)){ els.forEach(e=>e.classList.add('in')); return; }
    const io=new IntersectionObserver((ents)=>{
      ents.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
    },{threshold:.1, rootMargin:'0px 0px -40px 0px'});
    els.forEach(e=>io.observe(e));
  }
  window.initReveal=initReveal;
  if(document.readyState!=='loading') initReveal();
  else document.addEventListener('DOMContentLoaded', initReveal);
  // 兜底：若 2.5s 内动效未触发（如 observer 未生效/脚本异常），强制显示，避免整片空白
  setTimeout(()=>{ document.querySelectorAll('.reveal:not(.in)').forEach(e=>e.classList.add('in')); }, 2500);
})();

