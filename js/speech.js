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

  /* ---------- 내 말 인식 ---------- */
  listen({ onText, onEnd, onError }) {
    if (!this.sttSupported) { onError('이 브라우저는 음성 인식을 지원하지 않아요. 크롬에서 열거나 글자로 입력해 주세요.'); return null; }
    const rec = new Recognition();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = e => {
      // 매번 전체 결과로 다시 만든다(일부 안드로이드에서 결과가 겹쳐 오는 문제 대비)
      let fin = '', interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else interim += t;
      }
      finalText = fin;
      onText((fin + ' ' + interim).replace(/\s+/g, ' ').trim());
    };
    rec.onerror = e => {
      const msg = {
        'not-allowed': '마이크 사용이 허용되지 않았어요. 크롬 주소창 왼쪽 자물쇠 → 권한에서 마이크를 허용해 주세요.',
        'service-not-allowed': '마이크 사용이 허용되지 않았어요. 크롬 설정에서 마이크 권한을 확인해 주세요.',
        'no-speech': '말소리가 들리지 않았어요. 다시 눌러 말해 주세요.',
        'audio-capture': '마이크를 찾지 못했어요. 다른 앱이 마이크를 쓰고 있지 않은지 확인해 주세요.',
        'network': '음성 인식에 인터넷 연결이 필요해요. 연결을 확인하거나 글자로 입력해 주세요.'
      }[e.error] || '음성 인식 중 문제가 생겼어요. 다시 시도하거나 글자로 입력해 주세요.';
      if (e.error !== 'aborted') onError(msg);
    };
    rec.onend = () => onEnd(finalText.trim());
    try { rec.start(); } catch (err) { onError('음성 인식을 시작하지 못했어요. 잠시 후 다시 눌러 주세요.'); return null; }
    return { stop: () => { try { rec.stop(); } catch (e) { /* 이미 멈춤 */ } } };
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
