/* ============================================================
   音效系统 v4.0 — 完全离线 · 牌型专属语音 · 自然音色
   技术：Web Speech API (系统TTS) + Web Audio API (合成音效)
   完全离线可用，无需任何外部API
   ============================================================ */

const SFX = (() => {
  let ctx = null;
  let muted = false;
  let bgmGain = null;
  let sfxGain = null;
  let bgmPlaying = false;
  let cachedVoices = [];

  // ── AudioContext 初始化 ─────────────────────────────────
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.28;
      bgmGain.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.82;
      sfxGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── 振荡器（底层音效）──────────────────────────────────
  function playOsc({ type = 'sine', freq = 440, duration = 0.15, volume = 0.4,
    freqEnd = null, attack = 0.005, decay = 0.05, sustain = 0.3,
    release = 0.08, detune = 0, delay = 0 }) {
    if (muted) return;
    const c = getCtx();
    setTimeout(() => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      osc.detune.value = detune;
      if (freqEnd !== null)
        osc.frequency.linearRampToValueAtTime(freqEnd, c.currentTime + duration);
      const t = c.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + attack);
      gain.gain.linearRampToValueAtTime(volume * sustain, t + attack + decay);
      gain.gain.setValueAtTime(volume * sustain, t + duration - release);
      gain.gain.linearRampToValueAtTime(0, t + duration);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    }, delay);
  }

  function playNoise({ duration = 0.1, volume = 0.15, filterFreq = 3000,
    filterQ = 1.5, filterType = 'bandpass', delay = 0 }) {
    if (muted) return;
    const c = getCtx();
    setTimeout(() => {
      const bufSize = Math.floor(c.sampleRate * duration);
      const buf = c.createBuffer(1, bufSize, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      filter.Q.value = filterQ;
      const gain = c.createGain();
      gain.gain.setValueAtTime(volume, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      src.connect(filter); filter.connect(gain); gain.connect(sfxGain);
      src.start();
    }, delay);
  }

  // ── 语音系统（Web Speech API，完全离线）────────────────
  // 获取最佳中文声音
  function getBestZhVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (cachedVoices.length === 0) {
      cachedVoices = window.speechSynthesis.getVoices();
    }
    const voices = cachedVoices;
    // 优先顺序：中文女声 > 中文声 > 任意声音
    return voices.find(v => v.lang.startsWith('zh') && /female|女|Ting|Mei|Hanhan|Sinji/i.test(v.name))
      || voices.find(v => v.lang === 'zh-CN')
      || voices.find(v => v.lang.startsWith('zh'))
      || (voices.length > 0 ? voices[0] : null);
  }

  // 语速微扰动，让声音更自然（避免完全相同的机械重复）
  function naturalRate(base) {
    return base + (Math.random() - 0.5) * 0.12;
  }
  function naturalPitch(base) {
    return base + (Math.random() - 0.5) * 0.15;
  }

  // 说话（核心）
  function speak(text, opts = {}, audioDelay = 0) {
    if (muted) return;
    if (!('speechSynthesis' in window)) return;
    setTimeout(() => {
      // 不打断当前正在说的话（避免截断）
      // 但如果队列已积累太多，清掉
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = naturalRate(opts.rate || 1.05);
      utter.pitch = naturalPitch(opts.pitch || 1.0);
      utter.volume = muted ? 0 : (opts.volume || 0.95);
      const voice = getBestZhVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    }, audioDelay);
  }

  // ── 背景音乐（程序化五声音阶，完全离线）───────────────
  function generateBGM() {
    if (muted || bgmPlaying) return;
    bgmPlaying = true;
    const c = getCtx();
    // 中国风五声音阶（C调）
    const penta = [261.63, 293.66, 329.63, 392.00, 440.00,
                   523.25, 587.33, 659.25, 784.00, 880.00];
    const bpm = 112;
    const beat = 60 / bpm;

    function playBGMNote(freq, dur, startAt, vol, type) {
      if (!bgmPlaying) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(vol, startAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + dur);
      osc.connect(gain); gain.connect(bgmGain);
      osc.start(startAt);
      osc.stop(startAt + dur + 0.04);
    }

    function playPluck(freq, startAt, vol) {
      if (!bgmPlaying) return;
      const osc = c.createOscillator();
      const flt = c.createBiquadFilter();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      flt.type = 'lowpass';
      flt.frequency.value = freq * 2.8;
      gain.gain.setValueAtTime(vol, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.45);
      osc.connect(flt); flt.connect(gain); gain.connect(bgmGain);
      osc.start(startAt);
      osc.stop(startAt + 0.5);
    }

    function playDrums(startAt, beats, bt) {
      for (let i = 0; i < beats; i++) {
        if (i % 4 === 0) {
          const t = startAt + i * bt;
          const osc = c.createOscillator(), gain = c.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(140, t);
          osc.frequency.exponentialRampToValueAtTime(38, t + 0.14);
          gain.gain.setValueAtTime(0.15, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
          osc.connect(gain); gain.connect(bgmGain);
          osc.start(t); osc.stop(t + 0.22);
        }
        if (i % 4 === 2) {
          const t = startAt + i * bt;
          const bufSize = Math.floor(c.sampleRate * 0.07);
          const buf = c.createBuffer(1, bufSize, c.sampleRate);
          const d = buf.getChannelData(0);
          for (let j = 0; j < bufSize; j++) d[j] = Math.random() * 2 - 1;
          const src = c.createBufferSource();
          src.buffer = buf;
          const f = c.createBiquadFilter();
          f.type = 'highpass'; f.frequency.value = 4800;
          const g = c.createGain();
          g.gain.setValueAtTime(0.09, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
          src.connect(f); f.connect(g); g.connect(bgmGain);
          src.start(t);
        }
      }
    }

    const phrases = [
      [0,0.5],[2,0.5],[4,1],[2,0.5],[3,0.5],[1,1],
      [0,0.5],[4,0.5],[6,1],[5,0.5],[3,0.5],[1,2],
      [0,0.5],[2,0.5],[4,0.5],[5,0.5],[4,1],
      [3,0.5],[1,0.5],[0,2],
    ];
    const phraseDur = phrases.reduce((s, [, d]) => s + d, 0) * beat;

    function playPhrase() {
      if (!bgmPlaying || muted) return;
      let t = c.currentTime;
      phrases.forEach(([ni, dur]) => {
        const freq = penta[ni % penta.length];
        playBGMNote(freq, dur * beat * 0.88, t, 0.12, 'sine');
        playBGMNote(freq * 2, dur * beat * 0.65, t + 0.01, 0.04, 'triangle');
        t += dur * beat;
      });
      for (let i = 0; i < 8; i++) {
        const bt2 = c.currentTime + i * beat;
        playPluck(penta[0], bt2, 0.07);
        playPluck(penta[2], bt2 + beat * 0.5, 0.04);
      }
      playDrums(c.currentTime, 8, beat);
      setTimeout(playPhrase, (phraseDur + 0.15) * 1000);
    }

    playPhrase();
  }

  function stopBGM() {
    bgmPlaying = false;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
  function pauseBGM() { bgmPlaying = false; }
  function resumeBGM() { if (!bgmPlaying && !muted) generateBGM(); }

  // ── 具体音效函数 ────────────────────────────────────────

  function deal() {
    if (muted) return;
    playNoise({ duration: 0.055, volume: 0.2, filterFreq: 3800, filterQ: 2.2, filterType: 'bandpass' });
    playOsc({ type: 'triangle', freq: 820, freqEnd: 520, duration: 0.048, volume: 0.26, attack: 0.001, decay: 0.018, sustain: 0.08 });
  }

  function shuffle() {
    for (let i = 0; i < 9; i++) {
      setTimeout(() => {
        if (muted) return;
        playNoise({ duration: 0.065, volume: 0.18 + Math.random() * 0.1, filterFreq: 2200 + Math.random() * 2000, filterQ: 1.3 });
        playOsc({ type: 'triangle', freq: 580 + Math.random() * 320, freqEnd: 380, duration: 0.055, volume: 0.13 });
      }, i * 55);
    }
  }

  function flip() {
    playOsc({ type: 'sine', freq: 1080, freqEnd: 860, duration: 0.055, volume: 0.22, attack: 0.002 });
  }

  // 基础出牌音（无语音，语音由 playCardWithType 处理）
  function playCard() {
    if (muted) return;
    playNoise({ duration: 0.065, volume: 0.16, filterFreq: 2400, filterQ: 1.9 });
    playOsc({ type: 'triangle', freq: 580, freqEnd: 340, duration: 0.11, volume: 0.28, attack: 0.003 });
  }

  // ── 牌型专属语音 ────────────────────────────────────────
  // 玩家出牌时，根据牌型播报
  const typeVoiceMap = {
    single:    ['出牌', '要这张', '这张'],
    pair:      ['一对', '出对子', '对子'],
    trio:      ['三张', '三带', '出三张'],
    trio1:     ['三带一', '三带一'],
    trio2:     ['三带对', '三带对'],
    sequence:  ['顺子', '出顺子', '来个顺子'],
    seqPair:   ['连对', '连对出'],
    plane:     ['飞机', '飞机起飞', '飞机'],
    plane1:    ['飞机带翅膀', '飞机带小翼'],
    plane2:    ['飞机带对', '飞机带大翼'],
    bomb:      ['炸弹', '炸你', '轰！'],
    rocket:    ['王炸', '超级王炸', '无敌王炸！'],
  };

  // 玩家自己出牌语音
  function playCardVoice(type) {
    if (muted) return;
    const phrases = typeVoiceMap[type] || typeVoiceMap.single;
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    const isSpecial = type === 'bomb' || type === 'rocket';
    speak(text, {
      rate: isSpecial ? 1.25 : 1.1,
      pitch: isSpecial ? 1.35 : 1.05,
      volume: isSpecial ? 1.0 : 0.92,
    }, isSpecial ? 60 : 20);
  }

  // AI出牌语音（口吻略有不同）
  const aiTauntsByType = {
    single:   ['接这张', '来', '跟上'],
    pair:     ['对子', '一对', '跟上对子'],
    trio:     ['三张', '出三张'],
    trio1:    ['三带一', '三带着走'],
    trio2:    ['三带对', '三带对走'],
    sequence: ['顺子', '来个顺子'],
    seqPair:  ['连对', '对连'],
    plane:    ['飞机！', '起飞了', '飞机来了'],
    plane1:   ['飞机带翅', '带翼飞机'],
    plane2:   ['飞机带对', '大翼飞机'],
    bomb:     ['炸弹！', '轰！炸你', '炸弹来咯'],
    rocket:   ['王炸！', '无敌王炸！', '王炸，没得打'],
  };
  const aiPassPhrases = ['不出', '过', '让一让', '先放放', '随便'];

  function aiPlayVoice(isPass, cardType) {
    if (muted) return;
    let text;
    if (isPass) {
      text = aiPassPhrases[Math.floor(Math.random() * aiPassPhrases.length)];
    } else {
      const phrases = (cardType && aiTauntsByType[cardType]) || aiTauntsByType.single;
      text = phrases[Math.floor(Math.random() * phrases.length)];
    }
    const isSpecial = cardType === 'bomb' || cardType === 'rocket';
    speak(text, {
      rate: naturalRate(isSpecial ? 1.22 : 1.0),
      pitch: naturalPitch(isSpecial ? 1.3 : (0.82 + Math.random() * 0.28)),
      volume: isSpecial ? 1.0 : 0.88,
    }, isSpecial ? 60 : 0);
  }

  // ── 不出 ────────────────────────────────────────────────
  function pass() {
    if (muted) return;
    speak('不出', { rate: 1.0, pitch: 0.92, volume: 0.85 });
    playOsc({ type: 'sine', freq: 370, freqEnd: 290, duration: 0.14, volume: 0.1 });
  }

  // ── 炸弹 ────────────────────────────────────────────────
  function bomb() {
    if (muted) return;
    playNoise({ duration: 0.48, volume: 0.48, filterFreq: 380, filterQ: 0.7, filterType: 'lowpass' });
    playOsc({ type: 'sawtooth', freq: 95, freqEnd: 28, duration: 0.48, volume: 0.52, attack: 0.003, decay: 0.07 });
    playNoise({ duration: 0.28, volume: 0.32, filterFreq: 2200, filterQ: 1, delay: 55 });
    playOsc({ type: 'sine', freq: 55, freqEnd: 28, duration: 0.38, volume: 0.38, delay: 120 });
    // 语音稍晚播出，让爆炸音先出来
    speak('炸弹！', { rate: 1.25, pitch: 1.35, volume: 1.0 }, 90);
  }

  // ── 王炸 ────────────────────────────────────────────────
  function rocket() {
    if (muted) return;
    playNoise({ duration: 0.78, volume: 0.62, filterFreq: 280, filterQ: 0.45, filterType: 'lowpass' });
    playOsc({ type: 'sawtooth', freq: 125, freqEnd: 18, duration: 0.78, volume: 0.68, attack: 0.002 });
    [80, 160, 300].forEach(d =>
      playNoise({ duration: 0.38, volume: 0.38, filterFreq: 1600 + d * 3, filterQ: 1, delay: d })
    );
    // 双重震荡增强冲击感
    playOsc({ type: 'sine', freq: 200, freqEnd: 40, duration: 0.6, volume: 0.35, attack: 0.01, delay: 40 });
    speak('王炸！无敌！', { rate: 1.3, pitch: 1.5, volume: 1.0 }, 110);
  }

  // ── 叫地主 ──────────────────────────────────────────────
  function bid() {
    if (muted) return;
    speak('叫地主', { rate: 1.05, pitch: 1.12, volume: 0.92 });
    playOsc({ type: 'sine', freq: 640, duration: 0.09, volume: 0.32 });
    playOsc({ type: 'sine', freq: 860, duration: 0.11, volume: 0.38, delay: 105 });
  }

  function noBid() {
    if (muted) return;
    speak('不叫', { rate: 0.96, pitch: 0.88, volume: 0.82 });
    playOsc({ type: 'sine', freq: 430, freqEnd: 320, duration: 0.17, volume: 0.16 });
  }

  function robBid() {
    if (muted) return;
    speak('抢地主', { rate: 1.12, pitch: 1.22, volume: 0.92 });
    playOsc({ type: 'sine', freq: 680, duration: 0.08, volume: 0.32 });
    playOsc({ type: 'sine', freq: 880, duration: 0.09, volume: 0.38, delay: 88 });
    playOsc({ type: 'sine', freq: 1080, duration: 0.11, volume: 0.42, delay: 185 });
  }

  function noRob() {
    if (muted) return;
    speak('不抢', { rate: 0.96, pitch: 0.88, volume: 0.82 });
  }

  // ── 胜利 ────────────────────────────────────────────────
  function win() {
    if (muted) return;
    stopBGM();
    const melody = [523, 659, 784, 880, 1047, 880, 784, 1047];
    const durs   = [0.1, 0.1, 0.1, 0.1, 0.3, 0.1, 0.1, 0.5];
    let t = 0;
    melody.forEach((f, i) => {
      setTimeout(() => {
        playOsc({ type: 'sine', freq: f, duration: durs[i] + 0.05, volume: 0.42, attack: 0.01 });
        playOsc({ type: 'triangle', freq: f * 1.25, duration: durs[i], volume: 0.13 });
      }, t * 1000);
      t += durs[i];
    });
    setTimeout(() => {
      speak('恭喜获胜！', { rate: 1.0, pitch: 1.22, volume: 1.0 });
      [0, 110, 260].forEach(d =>
        setTimeout(() =>
          playNoise({ duration: 0.22, volume: 0.28, filterFreq: 3200 + d * 4, filterQ: 1.5 }), d)
      );
    }, 580);
  }

  // ── 失败 ────────────────────────────────────────────────
  function lose() {
    if (muted) return;
    stopBGM();
    const melody = [440, 415, 370, 330, 294];
    let t = 0;
    melody.forEach(f => {
      setTimeout(() => playOsc({ type: 'sine', freq: f, duration: 0.24, volume: 0.28, attack: 0.02 }), t);
      t += 200;
    });
    setTimeout(() => speak('很遗憾，失败了', { rate: 0.92, pitch: 0.82, volume: 0.92 }), 380);
  }

  // ── UI交互 ──────────────────────────────────────────────
  function click() {
    playOsc({ type: 'sine', freq: 880, freqEnd: 720, duration: 0.055, volume: 0.2, attack: 0.002 });
  }

  function tick() {
    playOsc({ type: 'square', freq: 1380, duration: 0.038, volume: 0.16, attack: 0.001 });
  }

  function join() {
    if (muted) return;
    playOsc({ type: 'sine', freq: 580, duration: 0.075, volume: 0.28 });
    playOsc({ type: 'sine', freq: 780, duration: 0.09, volume: 0.28, delay: 88 });
    speak('玩家加入', { rate: 1.08, pitch: 1.0, volume: 0.82 }, 180);
  }

  function countdown() {
    playOsc({ type: 'sine', freq: 1080, duration: 0.075, volume: 0.26, attack: 0.002 });
  }

  function landlordReveal() {
    if (muted) return;
    [0, 80, 160].forEach((d, i) => {
      setTimeout(() => {
        playOsc({ type: 'sine', freq: 380 + i * 160, duration: 0.14, volume: 0.28 });
        playNoise({ duration: 0.055, volume: 0.11, filterFreq: 2200, filterQ: 2 });
      }, d);
    });
    speak('地主牌揭晓', { rate: 1.0, pitch: 1.0, volume: 0.88 }, 280);
  }

  // ── 庆祝 ────────────────────────────────────────────────
  function winCelebration() {
    if (muted) return;
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        playNoise({ duration: 0.2, volume: 0.22 + Math.random() * 0.18,
          filterFreq: 2200 + Math.random() * 3800, filterQ: 1.5 });
        playOsc({ type: 'sine', freq: 620 + Math.random() * 580,
          duration: 0.14, volume: 0.18 });
      }, i * 175);
    }
  }

  // ── 静音控制 ────────────────────────────────────────────
  function toggleMute() {
    muted = !muted;
    if (bgmGain) bgmGain.gain.value = muted ? 0 : 0.28;
    if (sfxGain) sfxGain.gain.value = muted ? 0 : 0.82;
    if (muted) {
      stopBGM();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } else {
      generateBGM();
    }
    return muted;
  }

  function isMuted() { return muted; }

  // ── 初始化（首次用户交互后调用）───────────────────────
  function preloadVoices() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      cachedVoices = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
  }

  function init() {
    getCtx();
    preloadVoices();
    if (!muted) generateBGM();
  }

  return {
    init, deal, shuffle, flip, playCard, playCardVoice, pass,
    bomb, rocket, bid, noBid, robBid, noRob,
    win, lose, click, tick, join, countdown,
    landlordReveal, aiPlayVoice, winCelebration,
    toggleMute, isMuted, generateBGM, stopBGM, pauseBGM, resumeBGM
  };
})();
