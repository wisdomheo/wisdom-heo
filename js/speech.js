/* 음성 기능: 보호자 목소리(글자 읽기), 내 말 인식(음성 → 글자), 벨소리·진동
   모두 크롬에 들어 있는 기능을 쓴다. 음성 인식은 구글 서버를 거칠 수 있다. */
'use strict';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const Speech = {
  ttsSupported: 'speechSynthesis' in window,
  sttSupported: !!Recognition,

  /* ---------- 보호자 목소리 ---------- */
  koVoice() {
    if (!this.ttsSupported) return null;
    const voices = speechSynthesis.getVoices();
    return voices.find(v => /ko(-|_)KR/i.test(v.lang)) || voices.find(v => /^ko/i.test(v.lang)) || null;
  },
  /* (한숨) 같은 행동 묘사는 읽지 않는다 */
  speakable(text) { return String(text).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); },
  speak(text, rate) {
    return new Promise(resolve => {
      const say = this.speakable(text);
      if (!this.ttsSupported || !say) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(say);
      u.lang = 'ko-KR';
      u.rate = rate || 1;
      const voice = this.koVoice();
      if (voice) u.voice = voice;
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
      // 일부 휴대폰에서 끝 신호가 오지 않는 경우를 대비한 안전장치
      const guard = setTimeout(finish, say.length * 250 / (rate || 1) + 4000);
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    });
  },
  stopSpeaking() { if (this.ttsSupported) speechSynthesis.cancel(); },

  /* ---------- 내 말 인식 ----------
     안드로이드 크롬의 '계속 듣기'는 앞 문장을 다음 결과에 또 붙여 보내 말이 겹치는 문제가 있다.
     그래서 한 문장씩 짧게 듣고, '다 말했어요'를 누를 때까지 자동으로 다시 듣는다. */
  /* 이미 들어간 말은 다시 붙이지 않는다 */
  mergeText(prev, next) {
    const a = String(prev || '').trim(), b = String(next || '').trim();
    if (!b) return a;
    if (!a) return b;
    const na = a.replace(/\s+/g, ''), nb = b.replace(/\s+/g, '');
    if (nb.startsWith(na)) return b;          // 새 결과가 앞 문장까지 포함해 온 경우
    if (na.endsWith(nb)) return a;            // 같은 말이 한 번 더 온 경우
    return a + ' ' + b;
  },
  /* 한 번의 결과 안에서 같은 조각이 겹쳐 오면 하나만 남긴다 */
  sessionText(results) {
    let text = '';
    for (let i = 0; i < results.length; i++) text = this.mergeText(text, results[i][0].transcript);
    return text;
  },
  listen({ onText, onEnd, onError }) {
    if (!this.sttSupported) { onError('이 브라우저는 음성 인식을 지원하지 않아요. 크롬에서 열거나 글자로 입력해 주세요.'); return null; }
    const MESSAGES = {
      'not-allowed': '마이크 사용이 허용되지 않았어요. 크롬 주소창 왼쪽 자물쇠 → 권한에서 마이크를 허용해 주세요.',
      'service-not-allowed': '마이크 사용이 허용되지 않았어요. 크롬 설정에서 마이크 권한을 확인해 주세요.',
      'audio-capture': '마이크를 찾지 못했어요. 다른 앱이 마이크를 쓰고 있지 않은지 확인해 주세요.',
      'network': '음성 인식에 인터넷 연결이 필요해요. 연결을 확인하거나 글자로 입력해 주세요.'
    };
    let committed = '';     // 앞 문장들
    let current = '';       // 지금 듣고 있는 문장
    let wantStop = false;
    let fatal = false;
    let rec = null;
    let restarts = 0;

    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const startOne = () => {
      rec = new Rec();
      rec.lang = 'ko-KR';
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = e => {
        restarts = 0;
        current = this.sessionText(e.results);
        onText(this.mergeText(committed, current));
      };
      rec.onerror = e => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;   // 잠깐 쉰 것 → 다시 듣기
        fatal = true;
        onError(MESSAGES[e.error] || '음성 인식 중 문제가 생겼어요. 다시 시도하거나 글자로 입력해 주세요.');
      };
      rec.onend = () => {
        committed = this.mergeText(committed, current);
        current = '';
        // 너무 오래 조용하면(약 1분) 저절로 멈춘다
        if (!wantStop && !fatal && restarts < 30) {
          restarts++;
          try { startOne(); return; } catch (err) { /* 아래에서 마무리 */ }
        }
        onEnd(committed);
      };
      rec.start();
    };

    try { startOne(); } catch (err) { onError('음성 인식을 시작하지 못했어요. 잠시 후 다시 눌러 주세요.'); return null; }
    return { stop: () => { wantStop = true; try { rec.stop(); } catch (e) { /* 이미 멈춤 */ } } };
  },

  /* ---------- 벨소리·진동 ---------- */
  _ring: null,
  startRing() {
    this.stopRing();
    const state = { ctx: null, timer: null, vib: null };
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      state.ctx = new AC();
      const burst = () => {
        const ctx = state.ctx, t = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.05);
        gain.gain.setValueAtTime(0.25, t + 1.0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        gain.connect(ctx.destination);
        [440, 480].forEach(f => {
          const o = ctx.createOscillator();
          o.frequency.value = f;
          o.connect(gain);
          o.start(t); o.stop(t + 1.15);
        });
      };
      burst();
      state.timer = setInterval(burst, 2500);
    } catch (e) { /* 소리를 못 내도 연습은 계속 */ }
    if (navigator.vibrate) {
      navigator.vibrate([700, 300, 700]);
      state.vib = setInterval(() => navigator.vibrate([700, 300, 700]), 2500);
    }
    this._ring = state;
  },
  stopRing() {
    const s = this._ring;
    if (!s) return;
    clearInterval(s.timer); clearInterval(s.vib);
    if (navigator.vibrate) navigator.vibrate(0);
    if (s.ctx) s.ctx.close().catch(() => {});
    this._ring = null;
  }
};

if (Speech.ttsSupported) speechSynthesis.onvoiceschanged = () => {};   // 목소리 목록 미리 불러오기
