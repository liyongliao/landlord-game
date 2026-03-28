/* ============================================================
   欢乐斗地主 — 主游戏逻辑 v3.0
   商业化版本：人声音效 + 背景音乐 + 粒子特效 + 彩带
   ============================================================ */

// ─── 常量 ────────────────────────────────────────────────────
const SUITS    = ['♠', '♥', '♦', '♣'];
const RANKS    = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RANK_VAL = {
  '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,
  'J':11,'Q':12,'K':13,'A':14,'2':15,'小王':16,'大王':17
};
const AVATARS     = ['🐼','🐱','🐶','🐸','🐯','🦊','🐺','🐻','🐨','🦁'];
const BOT_AVATARS = ['🐯','🦊','🐺','🦁','🐻','🐨'];
const BOT_NAMES   = ['小虎AI','算法狐','数字狼','铁牌狮','机器熊','无敌Bot'];
const TURN_TIMEOUT = 20;

// ─── 游戏状态 ─────────────────────────────────────────────
let G = {
  deck: [],
  players: [
    { cards: [], isAI: false, name: '我',   avatar: '🐼', id: '' },
    { cards: [], isAI: true,  name: '猫咪', avatar: '🐱', id: 'bot1' },
    { cards: [], isAI: true,  name: '狗狗', avatar: '🐶', id: 'bot2' },
  ],
  landlordCards: [],
  landlordIndex: -1,
  currentTurn: 0,
  lastPlay: null,
  phase: 'idle',
  bidIndex: 0,
  bidResult: -1,
  baseScore: 1,
  multiplier: 1,
  totalScore: 0,
  selectedCards: [],
  isMultiplayer: false,
  myIndex: 0,
  roomId: null,
};

let bidQueue = [];
let robQueue = [];
let turnTimer = null;
let turnTimerCount = 0;
let autoPlay = false; // 托管模式

// ─── 建牌/洗牌 ────────────────────────────────────────────
function buildDeck() {
  const deck = [];
  SUITS.forEach(suit => RANKS.forEach(rank => {
    deck.push({ rank, suit, val: RANK_VAL[rank], isRed: suit==='♥'||suit==='♦' });
  }));
  deck.push({ rank:'小王', suit:'', val:16, isJoker:true, jokerType:'small' });
  deck.push({ rank:'大王', suit:'', val:17, isJoker:true, jokerType:'big' });
  return deck;
}
function shuffleDeck(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function sortCards(cards) { cards.sort((a,b) => b.val - a.val); }

// ─── 牌型判断 ─────────────────────────────────────────────
function getCardType(cards) {
  if (!cards || !cards.length) return null;
  const n = cards.length;
  const vals = cards.map(c => c.val).sort((a,b) => a-b);
  const counts = {};
  vals.forEach(v => counts[v] = (counts[v]||0)+1);
  const groups   = Object.values(counts).sort((a,b) => a-b);
  const uniqVals = Object.keys(counts).map(Number).sort((a,b) => a-b);

  if (n===2 && vals[0]===16 && vals[1]===17) return { type:'rocket', val:100, cards };
  if (n===4 && groups[0]===4) return { type:'bomb', val:vals[0], cards };
  if (n===1) return { type:'single', val:vals[0], cards };
  if (n===2 && groups[0]===2) return { type:'pair', val:vals[0], cards };
  if (n===3 && groups[0]===3) return { type:'triple', val:vals[0], cards };

  if (n===4) {
    const tv = uniqVals.find(v => counts[v]===3);
    if (tv !== undefined) return { type:'triple1', val:tv, cards };
  }
  if (n===5) {
    const tv = uniqVals.find(v => counts[v]===3);
    const dv = uniqVals.find(v => counts[v]===2);
    if (tv !== undefined && dv !== undefined) return { type:'triple2', val:tv, cards };
  }
  if (n>=5 && groups.every(g=>g===1) && vals.every(v=>v<=14)) {
    let ok = true;
    for (let i=1;i<vals.length;i++) if (vals[i]!==vals[i-1]+1){ok=false;break;}
    if (ok) return { type:'sequence', val:vals[0], len:n, cards };
  }
  if (n>=6 && n%2===0 && groups.every(g=>g===2) && uniqVals.every(v=>v<=14)) {
    let ok = true;
    for (let i=1;i<uniqVals.length;i++) if (uniqVals[i]!==uniqVals[i-1]+1){ok=false;break;}
    if (ok) return { type:'seqPair', val:uniqVals[0], len:n/2, cards };
  }
  const tripleVals = uniqVals.filter(v=>counts[v]>=3).sort((a,b)=>a-b);
  if (tripleVals.length>=2) {
    let seqOk = true;
    for (let i=1;i<tripleVals.length;i++) if (tripleVals[i]!==tripleVals[i-1]+1){seqOk=false;break;}
    if (seqOk) {
      const tc = tripleVals.length, tt = tc*3, kickers = n-tt;
      if (kickers===0) return { type:'plane',  val:tripleVals[0], len:tc, cards };
      if (kickers===tc) return { type:'plane1', val:tripleVals[0], len:tc, cards };
      if (kickers===tc*2) return { type:'plane2',val:tripleVals[0], len:tc, cards };
    }
  }
  if (n===6) {
    const fv = uniqVals.find(v=>counts[v]===4);
    if (fv !== undefined) return { type:'four2', val:fv, cards };
  }
  return null;
}

function canBeat(np, lp) {
  if (!lp) return true;
  if (np.type==='rocket') return true;
  if (lp.type==='rocket') return false;
  if (np.type==='bomb' && lp.type!=='bomb') return true;
  if (lp.type==='bomb' && np.type!=='bomb') return false;
  if (np.type!==lp.type) return false;
  if (['sequence','seqPair','plane','plane1','plane2'].includes(np.type)) {
    if (np.len!==lp.len) return false;
  }
  return np.val > lp.val;
}

// ─── AI 逻辑（优化版）───────────────────────────────────
function aiPlay(playerIdx, lastPlay) {
  const hand = G.players[playerIdx].cards;
  const isMust = !lastPlay || lastPlay.playerIndex === playerIdx;
  const allCombos = getAllCombos(hand);
  const isLandlord = G.landlordIndex === playerIdx;
  const handLen = hand.length;

  // 判断队友关系
  function isAlly(otherIdx) {
    if (isLandlord) return false;
    return G.landlordIndex !== otherIdx;
  }

  // 跟牌逻辑
  if (!isMust) {
    const valid = allCombos.filter(c => canBeat(c, lastPlay));
    if (!valid.length) return null;

    const lastPlayerIdx = lastPlay.playerIndex;
    const allyPlayed = isAlly(lastPlayerIdx);

    // 如果是队友出的牌，一般不压（除非自己只剩几张牌能赢）
    if (allyPlayed && handLen > 3) return null;

    // 排序：优先出小牌，保留炸弹
    valid.sort((a, b) => {
      const aIsBomb = a.type === 'bomb' || a.type === 'rocket';
      const bIsBomb = b.type === 'bomb' || b.type === 'rocket';
      if (aIsBomb && !bIsBomb) return 1;
      if (!aIsBomb && bIsBomb) return -1;
      return a.val - b.val;
    });

    // 如果对手只剩1-2张牌，必须压制
    const opponentLow = G.players.some((p, i) => {
      if (i === playerIdx || isAlly(i)) return false;
      return p.cards.length <= 2;
    });

    // 对手牌少，用炸弹也行
    if (opponentLow) return valid[0];

    // 普通情况：不轻易出炸弹
    const nonBomb = valid.filter(c => c.type !== 'bomb' && c.type !== 'rocket');
    if (nonBomb.length) return nonBomb[0];

    // 只剩炸弹了，手牌少于5张时可以用
    if (handLen <= 5) return valid[0];
    return null;
  }

  // 主动出牌逻辑
  if (!allCombos.length) return null;

  const byVal = {};
  hand.forEach(c => { (byVal[c.val] = byVal[c.val] || []).push(c); });

  // 分类
  const seqs     = allCombos.filter(c => c.type === 'sequence').sort((a, b) => b.len - a.len || a.val - b.val);
  const seqPairs = allCombos.filter(c => c.type === 'seqPair').sort((a, b) => b.len - a.len || a.val - b.val);
  const planes   = allCombos.filter(c => ['plane', 'plane1', 'plane2'].includes(c.type)).sort((a, b) => b.len - a.len || a.val - b.val);
  const triples  = allCombos.filter(c => ['triple', 'triple1', 'triple2'].includes(c.type)).sort((a, b) => a.val - b.val);
  const pairs    = allCombos.filter(c => c.type === 'pair').sort((a, b) => a.val - b.val);
  const singles  = allCombos.filter(c => c.type === 'single' && c.val < 15).sort((a, b) => a.val - b.val);
  const bombs    = allCombos.filter(c => c.type === 'bomb' || c.type === 'rocket').sort((a, b) => a.val - b.val);

  // 手牌少于等于5张时：尝试一次性打完
  if (handLen <= 5) {
    const wholeHand = getCardType(hand);
    if (wholeHand) return wholeHand;
  }

  // 优先级：飞机 > 顺子 > 连对 > 三带 > 对子 > 单张
  if (planes.length) return planes[0];
  if (seqs.length) return seqs[0];
  if (seqPairs.length) return seqPairs[0];

  // 三带策略：优先带出碎牌
  if (triples.length) {
    const tv = triples[0].val;
    const singleKick = singles.find(s => s.val !== tv && s.val < 15);
    if (singleKick && byVal[tv] && byVal[tv].length >= 3) {
      const combo = getCardType([...byVal[tv].slice(0, 3), singleKick.cards[0]]);
      if (combo) return combo;
    }
    const pairKick = pairs.find(p => p.val !== tv);
    if (pairKick && byVal[tv] && byVal[tv].length >= 3) {
      const combo = getCardType([...byVal[tv].slice(0, 3), ...pairKick.cards]);
      if (combo) return combo;
    }
    return triples[0];
  }

  // 出对子（不拆三张和炸弹）
  const safePairs = pairs.filter(p => byVal[p.val] && byVal[p.val].length === 2);
  if (safePairs.length) return safePairs[0];
  if (pairs.length) return pairs[0];

  // 出单张（从小到大，避免拆对/三张）
  const safeSingles = singles.filter(s => byVal[s.val] && byVal[s.val].length === 1);
  if (safeSingles.length) return safeSingles[0];
  if (singles.length) return singles[0];

  // 最后才用炸弹（手牌快出完时）
  if (bombs.length && handLen <= 6) return bombs[0];

  // 兜底
  const fallback = allCombos.filter(c => c.type !== 'bomb' && c.type !== 'rocket');
  if (fallback.length) {
    fallback.sort((a, b) => a.val - b.val);
    return fallback[0];
  }
  return allCombos[0];
}

function getAllCombos(hand) {
  const combos = [];
  const byVal = {};
  hand.forEach(c => { (byVal[c.val] = byVal[c.val]||[]).push(c); });
  const vals = Object.keys(byVal).map(Number).sort((a,b) => a-b);

  hand.forEach(c => combos.push(getCardType([c])));
  vals.forEach(v => { if (byVal[v].length>=2) combos.push(getCardType(byVal[v].slice(0,2))); });
  vals.forEach(v => {
    if (byVal[v].length>=3) {
      combos.push(getCardType(byVal[v].slice(0,3)));
      hand.forEach(c => { if (c.val!==v) combos.push(getCardType([...byVal[v].slice(0,3),c])); });
      vals.forEach(v2 => { if (v2!==v&&byVal[v2].length>=2) combos.push(getCardType([...byVal[v].slice(0,3),...byVal[v2].slice(0,2)])); });
    }
  });
  vals.forEach(v => { if (byVal[v].length===4) combos.push(getCardType(byVal[v])); });
  const small = hand.find(c=>c.val===16), big = hand.find(c=>c.val===17);
  if (small && big) combos.push(getCardType([small, big]));

  for (let s=0;s<vals.length;s++) {
    if (vals[s]>14) break;
    for (let len=5;s+len<=vals.length;len++) {
      const seq = vals.slice(s,s+len);
      if (seq[seq.length-1]>14) break;
      let ok=true;
      for (let i=1;i<seq.length;i++) if (seq[i]!==seq[i-1]+1){ok=false;break;}
      if (ok) combos.push(getCardType(seq.map(v=>byVal[v][0])));
    }
  }
  for (let s=0;s<vals.length;s++) {
    if (byVal[vals[s]].length<2||vals[s]>14) continue;
    const pv = [vals[s]];
    for (let n=s+1;n<vals.length;n++) {
      if (byVal[vals[n]].length<2||vals[n]>14) break;
      if (vals[n]===pv[pv.length-1]+1) pv.push(vals[n]); else break;
    }
    if (pv.length>=3) combos.push(getCardType(pv.flatMap(v=>byVal[v].slice(0,2))));
  }
  return combos.filter(Boolean);
}

function getHint(hand, lastPlay) {
  const combos = getAllCombos(hand);
  if (!lastPlay) {
    return combos.filter(c=>c.type==='single').sort((a,b)=>a.val-b.val)[0] || combos[0];
  }
  const valid = combos.filter(c=>canBeat(c,lastPlay));
  if (!valid.length) return null;
  valid.sort((a,b) => {
    if (a.type==='bomb'&&b.type!=='bomb') return 1;
    if (b.type==='bomb'&&a.type!=='bomb') return -1;
    return a.val - b.val;
  });
  return valid[0];
}

// ─── HTML生成 ─────────────────────────────────────────────
function cardHTML(card, small=false) {
  const cls = small ? 'card-sm' : 'card';
  if (card.isJoker) {
    const jcls = card.jokerType==='big' ? 'joker-big' : 'joker-small';
    const label = card.jokerType==='big' ? '🃏<br>大王' : '🃟<br>小王';
    return `<div class="${cls} ${jcls}"><div class="joker-text">${label}</div></div>`;
  }
  const color = card.isRed ? 'red' : 'black';
  return `<div class="${cls} ${color}" data-rank="${card.rank}">
    <div class="rank">${card.rank}</div>
    <div class="suit">${card.suit}</div>
  </div>`;
}

// ─── 渲染 ─────────────────────────────────────────────────
function renderPlayerCards() {
  const container = document.getElementById('bottomCards');
  container.innerHTML = '';
  G.players[0].cards.forEach((card, idx) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = cardHTML(card);
    const cardEl = wrap.firstElementChild;
    if (G.selectedCards.includes(idx)) cardEl.classList.add('selected');
    cardEl.addEventListener('click', () => { SFX.flip(); toggleCard(idx); });
    container.appendChild(cardEl);
  });
  updateCardCount(0);
}

function renderAICards() {
  [1, 2].forEach(pi => {
    const count = G.players[pi].cards.length;
    const idMap = { 1:'leftCards', 2:'rightCards' };
    const container = document.getElementById(idMap[pi]);
    container.innerHTML = '';
    const stackDiv = document.createElement('div');
    stackDiv.className = 'ai-card-stack';
    const show = Math.min(count, 7);
    for (let i=0;i<show;i++) {
      const d = document.createElement('div');
      d.className = 'ai-card-back';
      stackDiv.appendChild(d);
    }
    container.appendChild(stackDiv);
    const cnt = document.createElement('div');
    cnt.className = 'ai-card-count';
    cnt.textContent = `${count}张`;
    container.appendChild(cnt);
    updateCardCount(pi);
  });
}

function updateCardCount(pi) {
  const count = G.players[pi].cards.length;
  const idMap = ['bottomCardCount','leftCardCount','rightCardCount'];
  const el = document.getElementById(idMap[pi]);
  if (el) el.textContent = `${count}张`;
}

function renderLandlordCards(visible=false) {
  const container = document.getElementById('landlordCards');
  container.innerHTML = '';
  G.landlordCards.forEach(card => {
    if (visible) {
      container.innerHTML += cardHTML(card, true);
    } else {
      container.innerHTML += `<div class="ai-card-back" style="width:36px;height:52px;margin-top:0"></div>`;
    }
  });
}

function renderRoles() {
  const idMap = ['bottomRole','leftRole','rightRole'];
  G.players.forEach((p, i) => {
    const el = document.getElementById(idMap[i]);
    if (!el) return;
    if (G.landlordIndex === -1) { el.className='player-role-badge'; el.textContent=''; return; }
    if (i === G.landlordIndex) {
      el.textContent = '地主'; el.className = 'player-role-badge role-landlord';
    } else {
      el.textContent = '农民'; el.className = 'player-role-badge role-farmer';
    }
  });
}

function renderPlayerInfo() {
  document.getElementById('bottomName').textContent   = G.players[0].name;
  document.getElementById('bottomAvatar').textContent = G.players[0].avatar;
  document.getElementById('leftName').textContent     = G.players[1].name;
  document.getElementById('leftAvatar').textContent   = G.players[1].avatar;
  document.getElementById('rightName').textContent    = G.players[2].name;
  document.getElementById('rightAvatar').textContent  = G.players[2].avatar;
}

function setActiveTurn(pi) {
  // 清除所有高亮
  document.getElementById('leftPlayer').querySelector('.player-info-wrap').classList.remove('active-turn');
  document.getElementById('rightPlayer').querySelector('.player-info-wrap').classList.remove('active-turn');
  document.getElementById('bottomActiveBar').classList.remove('active');
  // 清除光效
  document.querySelectorAll('.turn-glow').forEach(el => el.classList.remove('active'));

  if (pi === 1) {
    document.getElementById('leftPlayer').querySelector('.player-info-wrap').classList.add('active-turn');
    document.getElementById('leftGlow').classList.add('active');
  } else if (pi === 2) {
    document.getElementById('rightPlayer').querySelector('.player-info-wrap').classList.add('active-turn');
    document.getElementById('rightGlow').classList.add('active');
  } else {
    document.getElementById('bottomActiveBar').classList.add('active');
  }
}

function showTurnTip(msg) {
  const el = document.getElementById('turnTip');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1500);
}

function showThink(pi, msg) {
  const idMap = { 1:'leftThink', 2:'rightThink' };
  const el = document.getElementById(idMap[pi]);
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 1600);
}

function updateScoreDisplay() {
  document.getElementById('baseScore').textContent  = G.baseScore;
  document.getElementById('multiplier').textContent = G.multiplier;
  document.getElementById('totalScore').textContent = G.totalScore;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function clearAllPlayed() {
  document.getElementById('centerPlayed').innerHTML    = '';
  document.getElementById('leftPlayed').innerHTML      = '';
  document.getElementById('rightPlayed').innerHTML     = '';
  document.getElementById('centerPlayedWho').textContent = '';
}

// ─── 圆形倒计时 ───────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 26; // r=26

function startTurnTimer(onTimeout) {
  clearTurnTimer();
  const wrap   = document.getElementById('timerBarWrap');
  const circle = document.getElementById('timerCircle');
  const text   = document.getElementById('timerText');
  turnTimerCount = TURN_TIMEOUT;
  wrap.style.display = 'block';
  circle.style.strokeDashoffset = '0';
  circle.classList.remove('urgent');
  text.classList.remove('urgent');

  function tick() {
    turnTimerCount--;
    const progress = turnTimerCount / TURN_TIMEOUT;
    circle.style.strokeDashoffset = ((1 - progress) * CIRCUMFERENCE).toFixed(2);
    text.textContent = turnTimerCount;
    if (turnTimerCount <= 5) {
      circle.classList.add('urgent');
      text.classList.add('urgent');
      SFX.tick();
    }
    if (turnTimerCount <= 0) {
      clearTurnTimer();
      onTimeout();
    } else {
      turnTimer = setTimeout(tick, 1000);
    }
  }
  turnTimer = setTimeout(tick, 1000);
}

function clearTurnTimer() {
  clearTimeout(turnTimer);
  turnTimer = null;
  document.getElementById('timerBarWrap').style.display = 'none';
}

// ─── 炸弹特效 ─────────────────────────────────────────────
function triggerBombEffect(isRocket) {
  const overlay = document.getElementById('bombOverlay');
  overlay.classList.remove('explode');
  void overlay.offsetWidth;
  overlay.classList.add('explode');
  setTimeout(() => overlay.classList.remove('explode'), 600);

  // 屏幕震动
  const gs = document.getElementById('gameScreen');
  gs.style.animation = 'none';
  void gs.offsetWidth;
  gs.style.animation = isRocket
    ? 'shake .5s ease-out'
    : 'shake .35s ease-out';
  setTimeout(() => gs.style.animation = '', 600);
}

// ─── 彩带特效 ─────────────────────────────────────────────
let confettiAnimId = null;
function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#f5c518','#e53935','#43a047','#1565c0','#9c27b0','#ff6b35','#fff'];
  const pieces = Array.from({length: 120}, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * canvas.height * 0.3,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 4,
    color: colors[Math.floor(Math.random()*colors.length)],
    vx: (Math.random()-0.5)*4,
    vy: 2 + Math.random()*4,
    rot: Math.random()*360,
    vr: (Math.random()-0.5)*8,
    alpha: 1,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.vr;
      if (frame > 80) p.alpha -= 0.012;
      if (p.y > canvas.height) { p.y=-10; p.x=Math.random()*canvas.width; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI/180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (pieces.some(p=>p.alpha>0)) {
      confettiAnimId = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0,0,canvas.width,canvas.height);
    }
  }
  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  confettiAnimId = requestAnimationFrame(draw);
}

// ─── 粒子背景（开始界面）─────────────────────────────────
function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W = canvas.width  = window.innerWidth;
  let H = canvas.height = window.innerHeight;

  const suits = ['♠','♥','♦','♣'];
  const particles = Array.from({length:28}, () => ({
    x: Math.random()*W, y: Math.random()*H,
    vx: (Math.random()-0.5)*0.6,
    vy: -0.3-Math.random()*0.5,
    size: 12 + Math.random()*14,
    alpha: 0.08 + Math.random()*0.18,
    suit: suits[Math.floor(Math.random()*4)],
    rot: Math.random()*360,
    vr: (Math.random()-0.5)*0.8,
    color: Math.random()>0.5 ? '#f5c518' : '#ff6b6b',
  }));

  function draw() {
    ctx.clearRect(0,0,W,H);
    particles.forEach(p => {
      p.x  += p.vx; p.y  += p.vy; p.rot += p.vr;
      if (p.y < -30) { p.y=H+10; p.x=Math.random()*W; }
      if (p.x < -30) p.x=W+10;
      if (p.x > W+30) p.x=-10;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot*Math.PI/180);
      ctx.font = `${p.size}px serif`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.suit, 0, 0);
      ctx.restore();
    });
    requestAnimationFrame(draw);
  }
  draw();

  window.addEventListener('resize', () => {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  });
}

// ─── 游戏初始化 ───────────────────────────────────────────
function initGame(opts = {}) {
  SFX.shuffle();
  G.deck = shuffleDeck(buildDeck());

  if (opts.players) {
    G.players = opts.players.map(p => ({ ...p, cards: [] }));
    G.isMultiplayer = true;
    G.myIndex = opts.myIndex || 0;
    G.roomId  = opts.roomId  || null;
  } else {
    G.isMultiplayer = false;
    G.myIndex = 0;
    G.players.forEach(p => p.cards = []);
  }

  G.landlordCards = [];
  G.landlordIndex = -1;
  G.currentTurn   = 0;
  G.lastPlay      = null;
  G.phase         = 'deal';
  G.bidIndex      = Math.floor(Math.random() * 3);
  G.bidResult     = -1;
  G.multiplier    = 1;
  G.selectedCards = [];

  // 重置托管状态
  autoPlay = false;
  const apBtn = document.getElementById('autoPlayBtn');
  if (apBtn) { apBtn.textContent = '🤖'; apBtn.title = '托管'; apBtn.style.background = ''; }

  // 发牌
  for (let i=0;i<51;i++) G.players[i%3].cards.push(G.deck[i]);
  G.landlordCards = G.deck.slice(51, 54);
  G.players.forEach(p => sortCards(p.cards));

  renderPlayerInfo();
  renderAICards();
  renderPlayerCards();
  renderLandlordCards(false);
  document.getElementById('landlordCardsArea').classList.remove('minimized');
  renderRoles();
  clearAllPlayed();
  updateScoreDisplay();
  setActiveTurn(-1);

  document.getElementById('actionBtns').style.display = 'none';
  document.getElementById('bidArea').style.display    = 'none';
  document.getElementById('robArea').style.display    = 'none';
  clearTurnTimer();

  // 背景音乐
  SFX.resumeBGM();

  showScreen('gameScreen');

  // 发牌动画
  setTimeout(() => {
    for (let i=0;i<17;i++) setTimeout(() => SFX.deal(), i*28);
    // 发牌动画效果
    const cards = document.getElementById('bottomCards').querySelectorAll('.card');
    cards.forEach((c,i) => {
      c.style.opacity='0';
      setTimeout(() => {
        c.classList.add('deal-anim');
        c.style.opacity='';
      }, i*28);
    });
    setTimeout(() => {
      G.phase = 'bid';
      startBidPhase();
    }, 650);
  }, 200);
}

// ─── 叫地主 ───────────────────────────────────────────────
function startBidPhase() {
  bidQueue = [G.bidIndex, (G.bidIndex+1)%3, (G.bidIndex+2)%3];
  G.bidResult = -1;
  nextBid();
}

function nextBid() {
  if (!bidQueue.length) {
    if (G.bidResult === -1) {
      showTurnTip('没人叫地主，重新发牌...');
      setTimeout(initGame, 1500);
      return;
    }
    startRobPhase();
    return;
  }
  const pi = bidQueue.shift();
  setActiveTurn(pi);
  if (pi === 0) {
    showBidUI(true);
    showTurnTip('轮到你叫地主');
    startTurnTimer(() => {
      showBidUI(false);
      SFX.noBid();
      showTurnTip('超时自动不叫');
      setTimeout(nextBid, 500);
    });
  } else {
    const want = Math.random() > 0.4;
    showThink(pi, '思考中...');
    setTimeout(() => {
      clearTurnTimer();
      if (want) {
        G.bidResult = pi;
        SFX.bid();
        showThink(pi, '我叫地主！');
        showTurnTip(`${G.players[pi].name} 叫地主！`);
      } else {
        SFX.noBid();
        showThink(pi, '不叫');
      }
      setTimeout(nextBid, 800);
    }, 600 + Math.random()*400);
  }
}

function showBidUI(show) {
  document.getElementById('bidArea').style.display = show ? 'flex' : 'none';
}
function showRobUI(show) {
  document.getElementById('robArea').style.display = show ? 'flex' : 'none';
}

// ─── 抢地主 ───────────────────────────────────────────────
function startRobPhase() {
  robQueue = [0,1,2].filter(i => i!==G.bidResult);
  G.phase = 'rob';
  nextRob();
}

function nextRob() {
  if (!robQueue.length) {
    assignLandlord(G.bidResult);
    return;
  }
  const pi = robQueue.shift();
  setActiveTurn(pi);
  if (pi === 0) {
    showRobUI(true);
    showTurnTip('是否抢地主？');
    startTurnTimer(() => {
      showRobUI(false);
      SFX.noRob();
      showTurnTip('超时自动不抢');
      setTimeout(nextRob, 500);
    });
  } else {
    const want = Math.random() > 0.55;
    showThink(pi, '要抢吗...');
    setTimeout(() => {
      clearTurnTimer();
      if (want) {
        G.bidResult  = pi;
        G.multiplier *= 2;
        SFX.robBid();
        showThink(pi, '我来抢！');
        showTurnTip(`${G.players[pi].name} 抢地主！×${G.multiplier}`);
        updateScoreDisplay();
      } else {
        SFX.noRob();
        showThink(pi, '算了');
      }
      setTimeout(nextRob, 700);
    }, 500 + Math.random()*400);
  }
}

// ─── 确定地主 ─────────────────────────────────────────────
function assignLandlord(pi) {
  G.landlordIndex = pi;
  G.currentTurn   = pi;
  G.players[pi].cards.push(...G.landlordCards);
  sortCards(G.players[pi].cards);

  showBidUI(false); showRobUI(false);
  renderLandlordCards(true);
  SFX.landlordReveal();
  setTimeout(() => {
    // 底牌缩小到右上角
    const zone = document.getElementById('landlordCardsArea');
    zone.classList.add('minimized');
    renderRoles();
    if (pi===0) renderPlayerCards(); else renderAICards();
    updateScoreDisplay();
    showTurnTip(`${G.players[pi].name} 成为地主！`);
    setTimeout(() => {
      G.phase = 'play';
      startPlayPhase();
    }, 1200);
  }, 600);
}

// ─── 出牌阶段 ─────────────────────────────────────────────
function startPlayPhase() {
  G.lastPlay = null;
  clearAllPlayed();
  nextTurn();
}

function nextTurn() {
  clearTurnTimer();
  setActiveTurn(G.currentTurn);
  const pi = G.currentTurn;

  if (pi === 0) {
    // 托管模式：自动由AI代打
    if (autoPlay) {
      showActionBtns(false);
      showTurnTip('托管出牌中...');
      setTimeout(() => doAITurn(0), 500 + Math.random()*300);
      return;
    }
    showActionBtns(true);
    // 检查是否有牌可以出，如果没有则自动提示
    const lastForPlayer = G.lastPlay && G.lastPlay.playerIndex!==0 ? G.lastPlay : null;
    if (lastForPlayer) {
      const hint = getHint(G.players[0].cards, lastForPlayer);
      if (!hint) {
        showTurnTip('没有牌能打过，自动不出');
        setTimeout(doPassAction, 800);
        return;
      }
    }
    showTurnTip('轮到你出牌');
    startTurnTimer(() => {
      const lastForPlayer2 = G.lastPlay && G.lastPlay.playerIndex!==0 ? G.lastPlay : null;
      if (lastForPlayer2) {
        doPassAction();
      } else {
        const hint = getHint(G.players[0].cards, null);
        if (hint) {
          G.selectedCards = [];
          hint.cards.forEach(hc => {
            const idx = G.players[0].cards.findIndex(c=>c.val===hc.val&&c.suit===hc.suit);
            if (idx!==-1 && !G.selectedCards.includes(idx)) G.selectedCards.push(idx);
          });
          renderPlayerCards();
          setTimeout(doPlayAction, 300);
        }
      }
    });
  } else {
    showActionBtns(false);
    showTurnTip(`${G.players[pi].name} 出牌中...`);
    showThink(pi, '想一想...');
    if (G.isMultiplayer && !G.players[pi].isAI) {
      startTurnTimer(() => {
        const play = aiPlay(pi, G.lastPlay && G.lastPlay.playerIndex!==pi ? G.lastPlay : null);
        executePlay(pi, play);
      });
    } else {
      setTimeout(() => doAITurn(pi), 700 + Math.random()*400);
    }
  }
}

function showActionBtns(show) {
  const btns = document.getElementById('actionBtns');
  btns.style.display = show ? 'flex' : 'none';
  if (show) {
    const canPass = G.lastPlay && G.lastPlay.playerIndex!==0;
    document.getElementById('passBtn').disabled = !canPass;
  }
}

function doAITurn(pi) {
  const lastForAI = G.lastPlay && G.lastPlay.playerIndex!==pi ? G.lastPlay : null;
  const play = aiPlay(pi, lastForAI);
  // AI语音（传入牌型，让语音更精准）
  SFX.aiPlayVoice(!play, play ? play.type : null);
  executePlay(pi, play);
}

function executePlay(pi, play) {
  const idMap = { 1:'leftPlayed', 2:'rightPlayed' };

  if (!play) {
    SFX.pass();
    showThink(pi, '不出');
    if (pi!==0) document.getElementById(idMap[pi]).innerHTML = '<div class="pass-tip">不出</div>';
    // 不出时保留中央上次出牌的展示，只更新文字信息
    document.getElementById('centerPlayedWho').textContent  = `${G.players[pi].name} 不出`;
    showTurnTip(`${G.players[pi].name} 不出`);
  } else {
    removeCards(pi, play.cards);
    G.lastPlay = { ...play, playerIndex: pi };

    // 音效
    if (play.type==='rocket') {
      SFX.rocket(); triggerBombEffect(true);
    } else if (play.type==='bomb') {
      SFX.bomb(); triggerBombEffect(false);
    } else {
      SFX.playCard();
      // 玩家出牌时播报牌型语音
      if (pi === 0) SFX.playCardVoice(play.type);
    }

    // 侧边展示
    if (pi!==0) {
      const side = document.getElementById(idMap[pi]);
      side.innerHTML = '';
      play.cards.forEach(c => { side.innerHTML += cardHTML(c,true); });
    }

    // 中间展示
    const center = document.getElementById('centerPlayed');
    center.innerHTML = '';
    play.cards.forEach(c => { center.innerHTML += cardHTML(c,true); });
    center.classList.add('center-anim');
    setTimeout(() => center.classList.remove('center-anim'), 300);
    document.getElementById('centerPlayedWho').textContent = `${G.players[pi].name} 出牌`;

    if (pi===0) renderPlayerCards(); else renderAICards();
    showTurnTip(`${G.players[pi].name} 出了${play.cards.length}张`);

    if (G.players[pi].cards.length === 0) {
      clearTurnTimer();
      setTimeout(() => endGame(pi), 700);
      return;
    }
  }

  G.currentTurn = (G.currentTurn+1) % 3;
  setTimeout(nextTurn, 750);
}

function removeCards(pi, cards) {
  cards.forEach(c => {
    const idx = G.players[pi].cards.findIndex(h => h.val===c.val && h.suit===c.suit);
    if (idx !== -1) G.players[pi].cards.splice(idx, 1);
  });
}

// ─── 玩家操作 ─────────────────────────────────────────────
function toggleCard(idx) {
  if (G.phase!=='play' || G.currentTurn!==0) return;
  const si = G.selectedCards.indexOf(idx);
  if (si===-1) G.selectedCards.push(idx);
  else G.selectedCards.splice(si, 1);
  renderPlayerCards();
}

function doPlayAction() {
  if (!G.selectedCards.length) { shakeHand(); showTurnTip('请先选择要出的牌'); return; }
  const selected = G.selectedCards.map(i => G.players[0].cards[i]);
  const play = getCardType(selected);
  if (!play) { shakeHand(); showTurnTip('不是合法牌型'); return; }
  const lastForPlayer = G.lastPlay && G.lastPlay.playerIndex!==0 ? G.lastPlay : null;
  if (lastForPlayer && !canBeat(play, lastForPlayer)) { shakeHand(); showTurnTip('出的牌太小了！'); return; }

  clearTurnTimer();
  const cardsToPlay = [...selected];
  G.selectedCards.sort((a,b)=>b-a).forEach(i => G.players[0].cards.splice(i,1));
  G.selectedCards = [];
  showActionBtns(false);

  if (G.isMultiplayer) {
    Network.sendGameEvent('PLAY', { cards: cardsToPlay, playType: play.type, playVal: play.val });
  }

  executePlay(0, { ...play, cards: cardsToPlay });
}

function doPassAction() {
  clearTurnTimer();
  G.selectedCards = [];
  renderPlayerCards();
  showActionBtns(false);
  if (G.isMultiplayer) Network.sendGameEvent('PASS', {});
  executePlay(0, null);
}

function playerPlay() { doPlayAction(); }
function playerPass() {
  if (!G.lastPlay || G.lastPlay.playerIndex===0) {
    showTurnTip('你是首出，必须出牌！');
    return;
  }
  doPassAction();
}
function playerHint() {
  const lastForPlayer = G.lastPlay && G.lastPlay.playerIndex!==0 ? G.lastPlay : null;
  const hint = getHint(G.players[0].cards, lastForPlayer);
  if (!hint) { showTurnTip('没有可出的牌，可以选择不出'); return; }
  G.selectedCards = [];
  hint.cards.forEach(hc => {
    const idx = G.players[0].cards.findIndex(c=>c.val===hc.val&&c.suit===hc.suit);
    if (idx!==-1 && !G.selectedCards.includes(idx)) G.selectedCards.push(idx);
  });
  renderPlayerCards();
}

function shakeHand() {
  const el = document.getElementById('bottomCards');
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

// ─── 结束游戏 ─────────────────────────────────────────────
function endGame(winnerIdx) {
  G.phase = 'end';
  showActionBtns(false);
  clearTurnTimer();
  SFX.stopBGM();

  const isPlayerWin    = winnerIdx === 0;
  const winnerIsLandlord = G.landlordIndex === winnerIdx;
  const pts = G.baseScore * G.multiplier;

  let title, detail, scoreDelta;
  if (isPlayerWin) {
    SFX.win();
    launchConfetti();
    SFX.winCelebration();
    if (winnerIsLandlord) {
      title = '大获全胜！'; detail = '地主出完手牌，笑到最后！';
      scoreDelta = pts*2; G.totalScore += pts*2;
    } else {
      title = '农民大胜！'; detail = '农民团结一心，扳倒地主！';
      scoreDelta = pts; G.totalScore += pts;
    }
  } else {
    SFX.lose();
    const w = G.players[winnerIdx];
    if (winnerIsLandlord) {
      title = '很遗憾...'; detail = `${w.name}（地主）出完所有手牌获胜！`;
      scoreDelta = -pts; G.totalScore -= pts;
    } else {
      title = '很遗憾...'; detail = `农民${w.name}胜利，地主遗憾落败！`;
      scoreDelta = -pts; G.totalScore -= pts;
    }
  }

  updateScoreDisplay();

  const revealHands = document.getElementById('revealHands');
  revealHands.innerHTML = '';
  G.players.forEach((p, i) => {
    if (!p.cards.length) return;
    const div = document.createElement('div');
    div.className = 'reveal-player';
    const roleTxt = i===G.landlordIndex ? '👑地主' : '🌾农民';
    div.innerHTML = `<div class="reveal-player-name">${p.avatar} ${p.name} ${roleTxt}（剩${p.cards.length}张）</div>`;
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'reveal-cards';
    p.cards.forEach(c => { cardsDiv.innerHTML += cardHTML(c,true); });
    div.appendChild(cardsDiv);
    revealHands.appendChild(div);
  });

  document.getElementById('resultIcon').textContent = isPlayerWin ? '🏆' : '😭';
  const titleEl = document.getElementById('resultTitle');
  titleEl.textContent = title;
  titleEl.className   = 'result-title ' + (isPlayerWin ? 'win' : 'lose');
  document.getElementById('resultDetail').textContent = detail;
  document.getElementById('resultScore').textContent  = (scoreDelta>=0?'+':'')+scoreDelta;

  if (G.isMultiplayer && G.roomId) Network.endRoom(G.roomId);

  setTimeout(() => showScreen('resultScreen'), 1000);
}

// ════════════════════════════════════════════════════════════
//  多人大厅逻辑
// ════════════════════════════════════════════════════════════
let myPlayerName = '小熊猫';
let currentRoom  = null;
let isRoomHost   = false;
let amIReady     = false;

function getPlayerName() {
  return document.getElementById('playerNameInput').value.trim() || '小熊猫';
}

function refreshRoomList() {
  const list  = document.getElementById('roomList');
  const rooms = Network.getRoomList();
  if (!rooms.length) {
    list.innerHTML = '<div class="room-empty">暂无房间，点击"创建房间"开局！</div>';
    return;
  }
  list.innerHTML = '';
  rooms.forEach(room => {
    const filled = room.seats.filter(Boolean).length;
    const item = document.createElement('div');
    item.className = 'room-item';
    item.innerHTML = `
      <div class="room-item-info">
        <div class="room-item-name">${escHtml(room.name)}</div>
        <div class="room-item-sub">房间号: ${room.id}　${filled}/3人</div>
      </div>
      <div class="room-item-seats">
        ${room.seats.map(s=>s?(s.isAI?'🤖':'👤'):'⬜').join('')}
      </div>
      <button class="room-item-join" data-room="${room.id}">加入</button>
    `;
    item.querySelector('.room-item-join').addEventListener('click', e => {
      e.stopPropagation(); SFX.click(); joinRoomById(room.id);
    });
    list.appendChild(item);
  });
}

function joinRoomById(roomId) {
  myPlayerName = getPlayerName();
  Network.init(myPlayerName);
  const result = Network.joinRoom(roomId, myPlayerName);
  if (!result.ok) { alert(result.msg); return; }
  currentRoom = result.room;
  isRoomHost  = false;
  amIReady    = false;
  SFX.join();
  enterRoomScreen(currentRoom);
}

function createNewRoom() {
  myPlayerName = getPlayerName();
  Network.init(myPlayerName);
  const roomId = Network.createRoom(myPlayerName, `${myPlayerName}的房间`);
  currentRoom  = Network.getRoom(roomId);
  isRoomHost   = true;
  amIReady     = false;
  SFX.join();
  enterRoomScreen(currentRoom);
}

function enterRoomScreen(room) {
  document.getElementById('roomTitle').textContent     = room.name;
  document.getElementById('roomIdDisplay').textContent = room.id;
  renderRoomSeats(room);
  showScreen('roomScreen');
  addChatMsg('系统', `欢迎来到 ${room.name}！`, true);
}

function renderRoomSeats(room) {
  room.seats.forEach((seat, idx) => {
    const avatarEl = document.getElementById(`seat${idx}Avatar`);
    const nameEl   = document.getElementById(`seat${idx}Name`);
    const tagEl    = document.getElementById(`seat${idx}Tag`);
    const btnsEl   = document.getElementById(`seat${idx}Btns`);
    const seatEl   = document.getElementById(`seat${idx}`);
    btnsEl.innerHTML = '';
    seatEl.classList.remove('occupied','me');

    if (!seat) {
      avatarEl.textContent = '❓';
      nameEl.textContent   = '空位';
      tagEl.textContent    = '';
      tagEl.className      = 'seat-tag';
      if (isRoomHost) {
        const btn = document.createElement('button');
        btn.className   = 'btn-add-bot';
        btn.textContent = '+ 添加机器人';
        btn.addEventListener('click', () => { SFX.click(); addBotToSeat(idx); });
        btnsEl.appendChild(btn);
      }
    } else {
      seatEl.classList.add('occupied');
      const isMe = seat.id === Network.getMyId();
      if (isMe) seatEl.classList.add('me');
      avatarEl.textContent = seat.isAI ? BOT_AVATARS[idx%BOT_AVATARS.length] : (AVATARS[idx]||'👤');
      nameEl.textContent   = seat.name;
      if (seat.isAI) {
        tagEl.textContent = '🤖 机器人'; tagEl.className = 'seat-tag ai';
      } else if (seat.id===room.hostId) {
        tagEl.textContent = '⭐ 房主'; tagEl.className = 'seat-tag host';
      } else if (seat.ready) {
        tagEl.textContent = '✅ 准备'; tagEl.className = 'seat-tag ready';
      } else {
        tagEl.textContent = '等待中'; tagEl.className = 'seat-tag waiting';
      }
      if (isRoomHost && seat.isAI) {
        const rmBtn = document.createElement('button');
        rmBtn.className   = 'btn-remove-seat';
        rmBtn.textContent = '× 移除';
        rmBtn.addEventListener('click', () => { SFX.click(); removeSeatFromRoom(idx); });
        btnsEl.appendChild(rmBtn);
      }
    }
  });

  const readyBtn = document.getElementById('readyBtn');
  const startBtn = document.getElementById('startGameFromRoomBtn');
  if (isRoomHost) {
    readyBtn.style.display = 'none';
    const canStart = room.seats.every(Boolean) &&
      room.seats.filter(s=>s&&!s.isAI).every(s=>s.id===room.hostId||s.ready);
    startBtn.style.display = canStart ? 'inline-block' : 'none';
    const empty   = room.seats.filter(s=>!s).length;
    const waiting = room.seats.filter(s=>s&&!s.isAI&&!s.ready&&s.id!==room.hostId).length;
    if (canStart)      document.getElementById('roomTip').textContent = '所有玩家就绪，可以开始！';
    else if (empty>0)  document.getElementById('roomTip').textContent = `还有${empty}个空位，可添加机器人`;
    else               document.getElementById('roomTip').textContent = `等待${waiting}位玩家准备...`;
  } else {
    readyBtn.style.display = 'inline-block';
    startBtn.style.display = 'none';
    readyBtn.textContent   = amIReady ? '❌ 取消准备' : '✅ 准备';
    readyBtn.className     = 'btn btn-ready' + (amIReady ? ' is-ready' : '');
    document.getElementById('roomTip').textContent = amIReady ? '已准备，等待房主开始...' : '点击准备开始游戏';
  }
}

function addBotToSeat(seatIdx) {
  if (!currentRoom) return;
  const name = BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)];
  currentRoom = Network.addBot(currentRoom.id, seatIdx, name);
  if (currentRoom) {
    addChatMsg('系统', `机器人 ${name} 加入了房间`, true);
    renderRoomSeats(currentRoom);
  }
}

function removeSeatFromRoom(seatIdx) {
  if (!currentRoom) return;
  const seat = currentRoom.seats[seatIdx];
  const name = seat ? seat.name : '';
  currentRoom = Network.removeSeat(currentRoom.id, seatIdx);
  if (currentRoom) {
    addChatMsg('系统', `${name} 离开了房间`, true);
    renderRoomSeats(currentRoom);
  }
}

function startMultiplayerGame() {
  if (!currentRoom) return;
  const room = Network.getRoom(currentRoom.id);
  if (!room || room.seats.some(s=>!s)) { alert('请填满所有席位（或添加机器人）'); return; }
  SFX.click();
  const myId = Network.getMyId();
  const mySeatIdx = room.seats.findIndex(s=>s&&s.id===myId);
  const orderedSeats = [
    room.seats[mySeatIdx],
    room.seats[(mySeatIdx+1)%3],
    room.seats[(mySeatIdx+2)%3],
  ];
  const players = orderedSeats.map((s,i) => ({
    id: s.id, name: s.name,
    isAI: s.isAI || s.id!==myId,
    avatar: s.isAI ? BOT_AVATARS[i%BOT_AVATARS.length] : AVATARS[i],
    cards: []
  }));
  Network.updateGameState(currentRoom.id, { started: true });
  initGame({ players, myIndex: 0, roomId: currentRoom.id, isMultiplayer: true });
}

// ─── 聊天 ─────────────────────────────────────────────────
function addChatMsg(who, text, isSystem=false) {
  const log = document.getElementById('chatLog');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isSystem?' system':'');
  div.innerHTML = isSystem
    ? `<span>${escHtml(text)}</span>`
    : `<span class="chat-who">${escHtml(who)}:</span>${escHtml(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function sendChatMsg() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addChatMsg(myPlayerName, text);
  if (currentRoom) Network.sendGameEvent('CHAT', { text, who: myPlayerName });
  SFX.click();
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── 网络消息处理 ─────────────────────────────────────────
let lobbyRefreshTimer = null;

Network.onMessage(msg => {
  if (!msg) return;
  // 其他标签页修改了 localStorage，自动刷新大厅
  if (msg.type==='STORAGE_CHANGED') {
    if (document.getElementById('lobbyScreen').classList.contains('active'))
      refreshRoomList();
    return;
  }
  if (msg.type==='ROOM_UPDATE' && msg.room) {
    if (currentRoom && msg.room.id===currentRoom.id) {
      currentRoom = msg.room;
      if (document.getElementById('roomScreen').classList.contains('active'))
        renderRoomSeats(currentRoom);
    }
    if (document.getElementById('lobbyScreen').classList.contains('active'))
      refreshRoomList();
  }
  if (msg.type==='GAME_EVENT' && msg.fromId!==Network.getMyId()) {
    if (msg.eventType==='CHAT') addChatMsg(msg.data.who, msg.data.text);
    if (msg.eventType==='PLAY' && G.phase==='play') {
      const pi = G.players.findIndex(p=>p.id===msg.fromId);
      if (pi!==-1 && pi===G.currentTurn) {
        clearTurnTimer();
        const hint = getHint(G.players[pi].cards,
          G.lastPlay && G.lastPlay.playerIndex!==pi ? G.lastPlay : null);
        executePlay(pi, hint);
      }
    }
    if (msg.eventType==='PASS' && G.phase==='play') {
      const pi = G.players.findIndex(p=>p.id===msg.fromId);
      if (pi!==-1 && pi===G.currentTurn) {
        clearTurnTimer();
        executePlay(pi, null);
      }
    }
  }
  if (msg.type==='PLAYER_JOIN' && msg.roomId===Network.getRoomId()) {
    addChatMsg('系统', `${msg.name} 加入了房间`, true);
    SFX.join();
  }
});

// ════════════════════════════════════════════════════════════
//  事件绑定
// ════════════════════════════════════════════════════════════

// 开始界面
document.getElementById('quickStartBtn').addEventListener('click', () => {
  SFX.init();
  SFX.click();
  myPlayerName = getPlayerName();
  G.players[0].name   = myPlayerName;
  G.players[0].avatar = '🐼';
  G.players[0].id     = 'human_0';
  G.totalScore = 0;
  initGame();
});
document.getElementById('multiBtn').addEventListener('click', () => {
  SFX.init();
  SFX.click();
  myPlayerName = getPlayerName();
  Network.init(myPlayerName);
  refreshRoomList();
  showScreen('lobbyScreen');
  // 进入大厅后每2秒自动刷新房间列表
  clearInterval(lobbyRefreshTimer);
  lobbyRefreshTimer = setInterval(() => {
    if (document.getElementById('lobbyScreen').classList.contains('active')) {
      refreshRoomList();
    } else {
      clearInterval(lobbyRefreshTimer);
    }
  }, 2000);
});
document.getElementById('ruleBtn').addEventListener('click', () => {
  SFX.init(); SFX.click(); showScreen('ruleScreen');
});

// 规则界面
document.getElementById('backFromRuleBtn').addEventListener('click', () => {
  SFX.click(); showScreen('startScreen');
});

// 大厅界面
document.getElementById('backFromLobbyBtn').addEventListener('click', () => {
  SFX.click(); showScreen('startScreen');
});
document.getElementById('createRoomBtn').addEventListener('click', () => {
  SFX.click(); createNewRoom();
});
document.getElementById('refreshRoomsBtn').addEventListener('click', () => {
  SFX.click(); refreshRoomList();
});

// 房间界面
document.getElementById('backFromRoomBtn').addEventListener('click', () => {
  SFX.click();
  if (currentRoom) Network.leaveRoom();
  currentRoom = null; isRoomHost = false; amIReady = false;
  showScreen('lobbyScreen');
  refreshRoomList();
});
document.getElementById('readyBtn').addEventListener('click', () => {
  SFX.click();
  amIReady = !amIReady;
  if (currentRoom) {
    currentRoom = Network.setReady(currentRoom.id, Network.getMyId(), amIReady);
    renderRoomSeats(currentRoom);
  }
});
document.getElementById('startGameFromRoomBtn').addEventListener('click', startMultiplayerGame);
document.getElementById('chatSendBtn').addEventListener('click', sendChatMsg);
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key==='Enter') sendChatMsg();
});

// 游戏内
document.getElementById('quitBtn').addEventListener('click', () => {
  SFX.click();
  clearTurnTimer();
  SFX.stopBGM();
  G.phase = 'idle';
  if (G.isMultiplayer && G.roomId) Network.leaveRoom();
  showScreen('startScreen');
  setTimeout(() => SFX.generateBGM(), 300);
});

document.getElementById('muteBtn').addEventListener('click', () => {
  const muted = SFX.toggleMute();
  document.getElementById('muteBtn').textContent = muted ? '🔇' : '🔊';
});

// 托管按钮
document.getElementById('autoPlayBtn').addEventListener('click', () => {
  SFX.click();
  autoPlay = !autoPlay;
  const btn = document.getElementById('autoPlayBtn');
  btn.textContent = autoPlay ? '🎮' : '🤖';
  btn.title = autoPlay ? '取消托管' : '托管';
  btn.style.background = autoPlay ? 'rgba(245,197,24,0.4)' : '';
  showTurnTip(autoPlay ? '已开启托管，AI代打' : '已取消托管');
  // 如果当前轮到玩家且开启托管，立刻让AI接管
  if (autoPlay && G.phase === 'play' && G.currentTurn === 0) {
    clearTurnTimer();
    showActionBtns(false);
    setTimeout(() => doAITurn(0), 400);
  }
});

// 叫地主
document.getElementById('bidYes').addEventListener('click', () => {
  clearTurnTimer(); showBidUI(false);
  G.bidResult = 0; SFX.bid();
  showTurnTip('我叫地主！');
  setTimeout(nextBid, 500);
});
document.getElementById('bidNo').addEventListener('click', () => {
  clearTurnTimer(); showBidUI(false);
  SFX.noBid(); showTurnTip('不叫');
  setTimeout(nextBid, 500);
});

// 抢地主
document.getElementById('robYes').addEventListener('click', () => {
  clearTurnTimer(); showRobUI(false);
  G.bidResult = 0; G.multiplier *= 2;
  SFX.robBid();
  showTurnTip(`我抢地主！×${G.multiplier}`);
  updateScoreDisplay();
  setTimeout(nextRob, 500);
});
document.getElementById('robNo').addEventListener('click', () => {
  clearTurnTimer(); showRobUI(false);
  SFX.noRob(); showTurnTip('不抢');
  setTimeout(nextRob, 500);
});

// 出牌
document.getElementById('playBtn').addEventListener('click', playerPlay);
document.getElementById('passBtn').addEventListener('click', playerPass);
document.getElementById('hintBtn').addEventListener('click', () => { SFX.click(); playerHint(); });

// 结算
document.getElementById('playAgainBtn').addEventListener('click', () => {
  SFX.click();
  if (G.isMultiplayer && currentRoom) {
    enterRoomScreen(currentRoom);
  } else {
    initGame();
  }
});
document.getElementById('backHomeBtn').addEventListener('click', () => {
  SFX.click();
  if (currentRoom) Network.leaveRoom();
  currentRoom = null;
  SFX.generateBGM();
  showScreen('startScreen');
});

// ─── 初始化 ───────────────────────────────────────────────
showScreen('startScreen');
initParticles();

// 开始界面背景音乐（首次用户交互时触发）
document.addEventListener('click', () => {
  SFX.init();
}, { once: true });
