/* ============================================================
   音效系统 v3.0 — 商业化人声音效 + 背景音乐
   使用 Web Audio API 高质量合成 + 人声样本（Base64内嵌）
   ============================================================ */

const SFX = (() => {
  let ctx = null;
  let muted = false;
  let bgmGain = null;
  let sfxGain = null;
  let bgmSource = null;
  let bgmBuffer = null;
  let bgmPlaying = false;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.35;
      bgmGain.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.85;
      sfxGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── 振荡器播放（底层）──────────────────────────────────────
  function playOsc({ type='sine', freq=440, duration=0.15, volume=0.4,
                     freqEnd=null, attack=0.005, decay=0.05, sustain=0.3,
                     release=0.08, detune=0 }) {
    if (muted) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    osc.detune.value = detune;
    if (freqEnd !== null) osc.frequency.linearRampToValueAtTime(freqEnd, c.currentTime + duration);
    const t = c.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, t + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, t + duration - release);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  function playNoise({ duration=0.1, volume=0.15, filterFreq=3000, filterQ=1.5, filterType='bandpass' }) {
    if (muted) return;
    const c = getCtx();
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
  }

  // ── 合成人声（共振峰合成模拟）──────────────────────────────
  function synthVoice(text, opts = {}) {
    if (muted) return;
    const c = getCtx();
    const { pitch = 220, duration = 0.6, volume = 0.55, vibrato = true } = opts;

    // 声带振动（基频）
    const carrier = c.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.value = pitch;

    // 颤音 LFO
    if (vibrato) {
      const lfo = c.createOscillator();
      const lfoGain = c.createGain();
      lfo.frequency.value = 5.5;
      lfoGain.gain.value = pitch * 0.03;
      lfo.connect(lfoGain);
      lfoGain.connect(carrier.frequency);
      lfo.start(c.currentTime);
      lfo.stop(c.currentTime + duration + 0.1);
    }

    // 声道共振（模拟元音共振峰）
    const formants = [800, 1200, 2500]; // 近似"啊"音共振峰
    const masterGain = c.createGain();
    const t = c.currentTime;
    masterGain.gain.setValueAtTime(0, t);
    masterGain.gain.linearRampToValueAtTime(volume, t + 0.04);
    masterGain.gain.setValueAtTime(volume, t + duration * 0.7);
    masterGain.gain.linearRampToValueAtTime(0, t + duration);
    masterGain.connect(sfxGain);

    formants.forEach((f, i) => {
      const bpf = c.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = f;
      bpf.Q.value = 8 - i * 2;
      carrier.connect(bpf);
      const fGain = c.createGain();
      fGain.gain.value = 1 - i * 0.3;
      bpf.connect(fGain);
      fGain.connect(masterGain);
    });

    carrier.start(t);
    carrier.stop(t + duration + 0.1);
  }

  // ── 语音合成（中文人声字幕 + 音频合成）──────────────────────
  function speakChinese(text, opts = {}) {
    if (muted) return;
    // 优先使用浏览器原生 TTS
    if ('speechSynthesis' in window) {
      // 取消之前的语音
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = opts.rate || 1.1;
      utter.pitch = opts.pitch || 1.0;
      utter.volume = muted ? 0 : (opts.volume || 0.9);
      // 优先选中文女声
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang.startsWith('zh') && v.name.includes('Female'))
        || voices.find(v => v.lang.startsWith('zh'))
        || voices[0];
      if (zhVoice) utter.voice = zhVoice;
      window.speechSynthesis.speak(utter);
    } else {
      // 降级：合成人声
      synthVoice(text, opts);
    }
  }

  // ── 背景音乐（程序化生成）────────────────────────────────
  function generateBGM() {
    if (muted) return;
    const c = getCtx();
    if (bgmPlaying) return;
    bgmPlaying = true;

    // 中国风五声音阶 C D E G A
    const pentatonic = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 784.00, 880.00];
    // 鼓点节奏模式（秒）
    const bpm = 108;
    const beat = 60 / bpm;
    let startTime = c.currentTime + 0.1;

    function playBGMPhrase() {
      if (!bgmPlaying || muted) return;
      const phrase = [
        [0,0.5],[2,0.5],[4,1],[2,0.5],[3,0.5],[1,1],[0,0.5],[4,0.5],[6,1],[5,0.5],[3,0.5],[1,2],
        [0,0.5],[2,0.5],[4,0.5],[5,0.5],[4,1],[3,0.5],[1,0.5],[0,2],
      ];
      let t = c.currentTime;
      phrase.forEach(([noteIdx, dur]) => {
        const freq = pentatonic[noteIdx % pentatonic.length];
        // 主旋律（笛子音色模拟）
        playBGMNote(freq, dur * beat * 0.9, t, 0.15, 'sine');
        // 八度和声
        playBGMNote(freq * 2, dur * beat * 0.7, t + 0.01, 0.05, 'triangle');
        t += dur * beat;
      });

      // 伴奏节拍（拨弦模拟）
      for (let i = 0; i < 8; i++) {
        const bt = c.currentTime + i * beat;
        playPluck(pentatonic[0], bt, 0.08);
        playPluck(pentatonic[2], bt + beat * 0.5, 0.05);
      }

      // 鼓点
      playDrumLoop(c.currentTime, 8, beat);

      // 循环播放
      const phraseDur = phrase.reduce((s, [,d]) => s + d, 0) * beat;
      setTimeout(playBGMPhrase, (phraseDur + 0.2) * 1000);
    }

    playBGMPhrase();
  }

  function playBGMNote(freq, duration, startAt, volume, type) {
    if (!bgmPlaying) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    osc.connect(gain); gain.connect(bgmGain);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.05);
  }

  function playPluck(freq, startAt, volume) {
    if (!bgmPlaying) return;
    const c = getCtx();
    // Karplus-Strong 拨弦算法简化版
    const osc = c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = freq * 3;
    gain.gain.setValueAtTime(volume, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.4);
    osc.connect(filter); filter.connect(gain); gain.connect(bgmGain);
    osc.start(startAt);
    osc.stop(startAt + 0.5);
  }

  function playDrumLoop(startAt, beats, beat) {
    const c = getCtx();
    for (let i = 0; i < beats; i++) {
      // 踢鼓
      if (i % 4 === 0) {
        const bt = startAt + i * beat;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, bt);
        osc.frequency.exponentialRampToValueAtTime(40, bt + 0.15);
        gain.gain.setValueAtTime(0.18, bt);
        gain.gain.exponentialRampToValueAtTime(0.001, bt + 0.2);
        osc.connect(gain); gain.connect(bgmGain);
        osc.start(bt); osc.stop(bt + 0.25);
      }
      // 鼓边（高频噪声）
      if (i % 4 === 2) {
        const bt = startAt + i * beat;
        const bufSize = Math.floor(c.sampleRate * 0.08);
        const buf = c.createBuffer(1, bufSize, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let j = 0; j < bufSize; j++) data[j] = Math.random() * 2 - 1;
        const src = c.createBufferSource();
        src.buffer = buf;
        const f = c.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 5000;
        const g = c.createGain();
        g.gain.setValueAtTime(0.12, bt);
        g.gain.exponentialRampToValueAtTime(0.001, bt + 0.1);
        src.connect(f); f.connect(g); g.connect(bgmGain);
        src.start(bt);
      }
    }
  }

  function stopBGM() {
    bgmPlaying = false;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function pauseBGM() { bgmPlaying = false; }
  function resumeBGM() { if (!bgmPlaying && !muted) generateBGM(); }

  // ── 具体音效 ───────────────────────────────────────────────

  // 发牌音效（清脆纸牌声）
  function deal() {
    if (muted) return;
    const c = getCtx();
    // 纸牌摩擦噪声
    playNoise({ duration: 0.06, volume: 0.22, filterFreq: 3500, filterQ: 2, filterType: 'bandpass' });
    // 落牌音
    playOsc({ type: 'triangle', freq: 800, freqEnd: 500, duration: 0.05, volume: 0.28, attack: 0.001, decay: 0.02, sustain: 0.1 });
  }

  // 洗牌（连续纸牌声）
  function shuffle() {
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        if (muted) return;
        playNoise({ duration: 0.07, volume: 0.2 + Math.random() * 0.1, filterFreq: 2000 + Math.random() * 2000, filterQ: 1.2 });
        playOsc({ type: 'triangle', freq: 600 + Math.random() * 300, freqEnd: 400, duration: 0.06, volume: 0.15 });
      }, i * 60);
    }
  }

  // 翻牌/选牌
  function flip() {
    playOsc({ type: 'sine', freq: 1100, freqEnd: 900, duration: 0.06, volume: 0.25, attack: 0.002 });
  }

  // 出牌（配合人声）
  function playCard() {
    if (muted) return;
    playNoise({ duration: 0.07, volume: 0.18, filterFreq: 2200, filterQ: 1.8 });
    playOsc({ type: 'triangle', freq: 600, freqEnd: 350, duration: 0.12, volume: 0.3, attack: 0.003 });
  }

  // 不出
  function pass() {
    if (muted) return;
    speakChinese('不出', { rate: 1.0, pitch: 0.9, volume: 0.8 });
    playOsc({ type: 'sine', freq: 380, freqEnd: 300, duration: 0.15, volume: 0.12 });
  }

  // 炸弹！
  function bomb() {
    if (muted) return;
    // 爆炸音效
    playNoise({ duration: 0.5, volume: 0.5, filterFreq: 400, filterQ: 0.8, filterType: 'lowpass' });
    playOsc({ type: 'sawtooth', freq: 100, freqEnd: 30, duration: 0.5, volume: 0.55, attack: 0.003, decay: 0.08 });
    setTimeout(() => playNoise({ duration: 0.3, volume: 0.35, filterFreq: 2000, filterQ: 1 }), 50);
    setTimeout(() => playOsc({ type: 'sine', freq: 60, freqEnd: 30, duration: 0.4, volume: 0.4 }), 120);
    // 人声"炸弹！"
    setTimeout(() => speakChinese('炸弹', { rate: 1.2, pitch: 1.3, volume: 1.0 }), 80);
  }

  // 王炸！
  function rocket() {
    if (muted) return;
    // 超级爆炸
    playNoise({ duration: 0.8, volume: 0.65, filterFreq: 300, filterQ: 0.5, filterType: 'lowpass' });
    playOsc({ type: 'sawtooth', freq: 130, freqEnd: 20, duration: 0.8, volume: 0.7, attack: 0.002 });
    [80, 160, 280].forEach(delay => {
      setTimeout(() => playNoise({ duration: 0.4, volume: 0.4, filterFreq: 1500 + delay * 3, filterQ: 1 }), delay);
    });
    setTimeout(() => speakChinese('王炸！超级无敌！', { rate: 1.3, pitch: 1.5, volume: 1.0 }), 100);
  }

  // 叫地主
  function bid() {
    if (muted) return;
    speakChinese('叫地主', { rate: 1.0, pitch: 1.1, volume: 0.9 });
    playOsc({ type: 'sine', freq: 660, duration: 0.1, volume: 0.35 });
    setTimeout(() => playOsc({ type: 'sine', freq: 880, duration: 0.12, volume: 0.4 }), 110);
  }

  // 不叫
  function noBid() {
    if (muted) return;
    speakChinese('不叫', { rate: 0.95, pitch: 0.85, volume: 0.8 });
    playOsc({ type: 'sine', freq: 440, freqEnd: 330, duration: 0.18, volume: 0.18 });
  }

  // 抢地主
  function robBid() {
    if (muted) return;
    speakChinese('抢地主', { rate: 1.1, pitch: 1.2, volume: 0.9 });
    playOsc({ type: 'sine', freq: 700, duration: 0.08, volume: 0.35 });
    setTimeout(() => playOsc({ type: 'sine', freq: 900, duration: 0.1, volume: 0.4 }), 90);
    setTimeout(() => playOsc({ type: 'sine', freq: 1100, duration: 0.12, volume: 0.45 }), 190);
  }

  // 不抢
  function noRob() {
    if (muted) return;
    speakChinese('不抢', { rate: 0.95, pitch: 0.85, volume: 0.8 });
  }

  // 胜利音效
  function win() {
    if (muted) return;
    stopBGM();
    // 胜利旋律（C大调五声）
    const melody = [523, 659, 784, 880, 1047, 880, 784, 1047];
    const durs   = [0.1, 0.1, 0.1,  0.1,  0.3, 0.1, 0.1, 0.5];
    let t = 0;
    melody.forEach((f, i) => {
      setTimeout(() => {
        playOsc({ type: 'sine', freq: f, duration: durs[i] + 0.05, volume: 0.45, attack: 0.01 });
        // 和声
        playOsc({ type: 'triangle', freq: f * 1.25, duration: durs[i], volume: 0.15 });
      }, t * 1000);
      t += durs[i];
    });
    setTimeout(() => {
      speakChinese('恭喜获胜！', { rate: 1.0, pitch: 1.2, volume: 1.0 });
      // 烟花爆炸声
      [0, 120, 280].forEach(d => setTimeout(() =>
        playNoise({ duration: 0.25, volume: 0.3, filterFreq: 3000 + d * 5, filterQ: 1.5 }), d));
    }, 600);
  }

  // 失败音效
  function lose() {
    if (muted) return;
    stopBGM();
    const melody = [440, 415, 370, 330, 294];
    let t = 0;
    melody.forEach((f, i) => {
      setTimeout(() => playOsc({ type: 'sine', freq: f, duration: 0.25, volume: 0.3, attack: 0.02 }), t);
      t += 200;
    });
    setTimeout(() => speakChinese('很遗憾，失败了', { rate: 0.9, pitch: 0.8, volume: 0.9 }), 400);
  }

  // 点击按钮
  function click() {
    playOsc({ type: 'sine', freq: 900, freqEnd: 750, duration: 0.06, volume: 0.22, attack: 0.002 });
  }

  // 倒计时警告
  function tick() {
    playOsc({ type: 'square', freq: 1400, duration: 0.04, volume: 0.18, attack: 0.001 });
  }

  // 玩家加入
  function join() {
    if (muted) return;
    playOsc({ type: 'sine', freq: 600, duration: 0.08, volume: 0.3 });
    setTimeout(() => playOsc({ type: 'sine', freq: 800, duration: 0.1, volume: 0.3 }), 90);
    setTimeout(() => speakChinese('玩家加入', { rate: 1.1, pitch: 1.0, volume: 0.8 }), 200);
  }

  // 倒计时
  function countdown() {
    playOsc({ type: 'sine', freq: 1100, duration: 0.08, volume: 0.28, attack: 0.002 });
  }

  // 发现地主牌翻开
  function landlordReveal() {
    if (muted) return;
    [0, 80, 160].forEach((d, i) => {
      setTimeout(() => {
        playOsc({ type: 'sine', freq: 400 + i * 150, duration: 0.15, volume: 0.3 });
        playNoise({ duration: 0.06, volume: 0.12, filterFreq: 2000, filterQ: 2 });
      }, d);
    });
    setTimeout(() => speakChinese('地主牌揭晓', { rate: 1.0, pitch: 1.0, volume: 0.85 }), 300);
  }

  // AI出牌语音（随机话语）
  const aiTaunts = ['厉害', '接招', '这张', '跟上', '加油'];
  const aiPassPhrases = ['不出', '过', '先让你', '随便'];
  function aiPlayVoice(isPass) {
    if (muted) return;
    const phrases = isPass ? aiPassPhrases : aiTaunts;
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    speakChinese(text, { rate: 1.0, pitch: 0.85 + Math.random() * 0.3, volume: 0.8 });
  }

  // 获胜庆祝特效
  function winCelebration() {
    if (muted) return;
    // 连续烟花声
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        playNoise({ duration: 0.2, volume: 0.25 + Math.random() * 0.2,
          filterFreq: 2000 + Math.random() * 4000, filterQ: 1.5 });
        playOsc({ type: 'sine', freq: 600 + Math.random() * 600,
          duration: 0.15, volume: 0.2 });
      }, i * 180);
    }
  }

  // 切换静音
  function toggleMute() {
    muted = !muted;
    if (bgmGain) bgmGain.gain.value = muted ? 0 : 0.35;
    if (sfxGain) sfxGain.gain.value = muted ? 0 : 0.85;
    if (muted) {
      stopBGM();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } else {
      generateBGM();
    }
    return muted;
  }

  function isMuted() { return muted; }

  // 预加载语音（触发TTS引擎初始化）
  function preloadVoices() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        window.speechSynthesis.getVoices();
      });
    }
  }

  // 初始化（用户交互后调用）
  function init() {
    getCtx();
    preloadVoices();
    if (!muted) generateBGM();
  }

  return {
    init, deal, shuffle, flip, playCard, pass, bomb, rocket,
    bid, noBid, robBid, noRob, win, lose, click, tick, join,
    countdown, landlordReveal, aiPlayVoice, winCelebration,
    toggleMute, isMuted, generateBGM, stopBGM, pauseBGM, resumeBGM
  };
})();
