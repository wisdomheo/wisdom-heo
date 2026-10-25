/* 보호자 전화상담 연습실 — 2차 버전(어플)
   화면: 첫 화면 / 설정 / 기록 / 벨 울림 / AI 통화 / 대본 연습 / 채점 중 / 결과 */
'use strict';

/* =========================================================
   1. 장면·선택지 도우미 (대본 모드)
   ========================================================= */
const SCENE_GREET = 0, SCENE_INTAKE = 4, SCENE_GUIDE = 5, SCENE_CLOSING = 6;
const SCENE_GOAL = 2;
/* RECOMMENDED_MINUTES, SPEED_RULE, MARK, INTAKE_BY_KEY는 data.js에 있다 */
/* 평가 항목 → 복습할 대본 장면 */
const ITEM_TO_SCENE = { greet: 0, problem: 1, listen: 1, goal: 2, empathy: 3, explain: 5, action: 5, closing: 6 };

function optionsFor(c, sceneIdx) {
  if (sceneIdx === SCENE_GREET) return GREET_OPTIONS;
  if (sceneIdx === SCENE_INTAKE) return CONSENT_OPTIONS;
  if (sceneIdx === SCENE_CLOSING) return [c.scenes[SCENE_CLOSING].closing].concat(CLOSING_SHARED);
  return c.scenes[sceneIdx].options;
}
function subOptionsFor(sceneIdx) {
  if (sceneIdx === SCENE_INTAKE) return HISTORY_OPTIONS;
  if (sceneIdx === SCENE_CLOSING) return HANGUP_OPTIONS;
  return null;
}
const SUB_TEXT = {
  [SCENE_INTAKE]: { main: '청소년 본인의 동의 확인과 가장 가까운 것은?', sub: '이전 상담 경험 확인과 가장 가까운 것은?', err: '이전 상담 경험 확인 응답도 골라 주세요.' },
  [SCENE_CLOSING]: { main: '마무리 인사와 가장 가까운 것은?', sub: '통화를 어떻게 끝낼까요?', err: '통화를 끝내는 방식도 골라 주세요.' }
};
function parentLine(c, sceneIdx) { return sceneIdx === SCENE_GREET ? null : c.scenes[sceneIdx].p; }
function reactionOf(c, sceneIdx, opt, kind) {
  if (sceneIdx === SCENE_GREET) return (opt.prefix || '') + c.opening;
  if (sceneIdx === SCENE_INTAKE && opt.id === 'a') return kind === 'sub' ? c.scenes[SCENE_INTAKE].historyR : c.scenes[SCENE_INTAKE].consentR;
  return opt.r;
}
function sumScore(o) { return Object.values(o.s).reduce((a, b) => a + b, 0); }
function bestOf(opts) { return opts.reduce((best, o) => (sumScore(o) > sumScore(best) ? o : best), opts[0]); }

/* =========================================================
   2. 공통 유틸리티
   ========================================================= */
function esc(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function caseById(id) { return CASES.find(c => c.id === id); }
function speedScore(sec) { return SPEED_RULE.find(r => sec <= r.upTo).score; }
function gradeOf(score100) {
  if (score100 >= 90) return { label: '매우양호', cls: '' };
  if (score100 >= 80) return { label: '양호', cls: '' };
  if (score100 >= 70) return { label: '보통', cls: 'g-mid' };
  if (score100 >= 60) return { label: '불량', cls: 'g-low' };
  return { label: '매우불량', cls: 'g-low' };
}
function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function areasOf(items) {
  return AREAS.map(ar => ({
    name: ar.name, max: ar.max,
    score: RUBRIC.filter(r => r.area === ar.name).reduce((a, r) => a + (items[r.key] ? items[r.key].score : 0), 0)
  }));
}
const MODE_LABEL = { ai: '🤖 AI 대화', script: '📄 대본', focus: '🎯 집중 연습' };

/* =========================================================
   3. 상태
   ========================================================= */
const app = {
  screen: 'home',
  session: null,
  resultTab: 'score',
  settingsMsg: '',
  pendingStart: null,     // AI 동의 후 이어서 시작할 연습
  historyOpen: null       // 기록 화면에서 펼친 기록 id
};
let micCtl = null;
let clockTimer = null;

/* =========================================================
   4. 연습 시작
   ========================================================= */
function requestStart(caseId, random) {
  const settings = Store.settings();
  if (settings.mode === 'ai') {
    if (!Store.apiKey()) {
      app.settingsMsg = 'AI 대화 모드를 쓰려면 API 키를 먼저 입력해 주세요. 키가 없으면 첫 화면에서 대본 모드를 고르세요.';
      go('settings');
      return;
    }
    if (!Store.aiConsent()) { app.pendingStart = { caseId, random }; openConsent(); return; }
  }
  startPractice(caseId, random, settings.mode);
}

function startPractice(caseId, random, mode) {
  const c = random ? CASES[Math.floor(Math.random() * CASES.length)] : caseById(caseId);
  const s = newSession(mode, c.id, random);
  if (mode === 'script') {
    s.steps = SCENE_META.map((_, i) => ({ caseId: c.id, sceneIdx: i }));
    prepareScript(s);
  }
  app.session = s;
  s.ringAt = Date.now();
  s.startTime = s.ringAt;
  Speech.startRing();
  go('ring');
}

function startFocus() {
  const s = newSession('focus', null, false);
  s.steps = CASES.map(c => ({ caseId: c.id, sceneIdx: SCENE_GOAL }));
  prepareScript(s);
  s.startTime = Date.now();
  app.session = s;
  go('script');
  enterScene();
}

function newSession(mode, caseId, random) {
  return {
    id: 'r' + Date.now(), mode, caseId, random,
    transcript: [], speedSec: null, ringAt: null, startTime: null,
    parentEnded: false, hangup: null, busy: false, err: '',
    listening: false, interim: '', draft: null, micErr: '', warned15: false
  };
}

function answerCall() {
  const s = app.session;
  Speech.stopRing();
  s.speedSec = Math.round((Date.now() - s.ringAt) / 100) / 10;
  if (s.mode === 'ai') {
    s.transcript.push({ who: 'sys', text: `☎️ ${s.speedSec}초 만에 전화를 받았습니다. 첫인사를 말해 주세요.` });
    go('call');
  } else {
    go('script');
    enterScene();
  }
}

/* =========================================================
   5. 마이크 (AI 통화·대본 공통)
   ========================================================= */
function startMic() {
  const s = app.session;
  Speech.stopSpeaking();
  s.micErr = '';
  s.interim = '';
  s.listening = true;
  micCtl = Speech.listen({
    onText: t => {
      s.interim = t;
      const el = document.getElementById('interim');
      if (el) el.textContent = t || '듣고 있어요…';
    },
    onEnd: finalText => {
      if (!s.listening) return;
      s.listening = false;
      micCtl = null;
      const said = (finalText || s.interim || '').trim();
      if (said && Store.settings().autoSend) { sendSaid(said); return; }
      s.draft = said;
      if (!said && !s.micErr) s.micErr = '알아들은 말이 없어요. 다시 말하거나 글자로 입력해 주세요.';
      render();
    },
    onError: msg => { s.micErr = msg; }
  });
  if (!micCtl) s.listening = false;
  render();
}
function stopMic() { if (micCtl) micCtl.stop(); }

function sendSaid(text) {
  const s = app.session;
  const said = String(text || '').trim();
  if (!said) { s.micErr = '보낼 말이 없어요. 말하거나 글자로 입력해 주세요.'; render(); return; }
  s.draft = null; s.interim = ''; s.micErr = '';
  if (s.mode === 'ai') aiSend(said); else scriptSaid(said);
}

/* =========================================================
   6. AI 통화
   ========================================================= */
function aiSend(said) {
  const s = app.session;
  s.transcript.push({ who: 'me', text: said });
  requestParentReply();
}
async function requestParentReply() {
  const s = app.session;
  s.busy = true; s.err = '';
  render();
  try {
    const reply = await AI.parentReply(caseById(s.caseId), s.transcript, Store.settings(), Store.apiKey());
    if (app.session !== s) return;              // 그사이 연습을 그만둔 경우
    s.transcript.push({ who: 'parent', text: reply.text });
    if (reply.ended) { s.parentEnded = true; s.transcript.push({ who: 'sys', text: '보호자가 전화를 끊었습니다. [통화 종료]를 눌러 주세요.' }); }
    s.busy = false;
    render();
    Speech.speak(reply.text, Store.settings().rate);
  } catch (e) {
    if (app.session !== s) return;
    s.busy = false;
    s.err = e.message || 'AI 연결 중 문제가 생겼어요.';
    render();
  }
}
function endCall() {
  const s = app.session;
  if (!s.transcript.some(t => t.who === 'me')) {
    if (window.confirm('아직 아무 말도 하지 않았어요. 연습을 그만두고 처음 화면으로 갈까요?')) goHome();
    return;
  }
  if (!s.parentEnded && !window.confirm('보호자가 아직 전화를 끊지 않았어요. 지금 끊으면 \'끊는 순서\'가 0점이 됩니다. 끊을까요?')) return;
  stopMic();
  Speech.stopSpeaking();
  s.hangup = s.parentEnded ? 5 : 0;
  s.elapsed = Date.now() - s.startTime;
  go('evaluating');
  runEvaluation();
}
async function runEvaluation() {
  const s = app.session;
  s.evalErr = '';
  render();
  try {
    const ev = await AI.evaluate(caseById(s.caseId), s.transcript, Store.settings(), Store.apiKey());
    if (app.session !== s) return;
    s.eval = ev;
    s.result = aiResult(s);
    saveRecord(s);
    app.resultTab = 'score';
    go('result');
  } catch (e) {
    if (app.session !== s) return;
    s.evalErr = e.message || 'AI 채점 중 문제가 생겼어요.';
    render();
  }
}
function aiResult(s) {
  const items = {};
  Object.entries(s.eval.items).forEach(([k, v]) => { items[k] = { score: v.score, max: RUBRIC.find(r => r.key === k).max }; });
  items.speed = { score: speedScore(s.speedSec), max: 5 };
  items.hangup = { score: s.hangup, max: 5 };
  const total = Object.values(items).reduce((a, it) => a + it.score, 0);
  return { items, total, areas: areasOf(items), intake: s.eval.intake, checklist: s.eval.checklist };
}

/* =========================================================
   7. 대본 연습 (대본 모드·집중 연습)
   ========================================================= */
function prepareScript(s) {
  s.stepIdx = 0;
  s.answers = s.steps.map(() => ({ optId: null, subId: null, said: '' }));
  s.orders = s.steps.map(st => shuffle(optionsFor(caseById(st.caseId), st.sceneIdx).map(o => o.id)));
  s.subOrders = s.steps.map(st => {
    const subs = s.mode === 'focus' ? null : subOptionsFor(st.sceneIdx);
    return subs ? shuffle(subs.map(o => o.id)) : null;
  });
}
function curStep() { const s = app.session; return s.steps[s.stepIdx]; }

function enterScene() {
  const s = app.session;
  const st = curStep();
  const c = caseById(st.caseId);
  s.phase = 'speak';
  s.draft = null; s.micErr = ''; s.choiceErr = '';
  s.sceneStart = s.sceneStart || [];
  s.sceneStart[s.stepIdx] = s.transcript.length;     // 화면에는 지금 장면의 대화만 보여 준다
  if (s.mode === 'focus') s.transcript.push({ who: 'sys', text: `[${c.title}] ${c.goalContext}` });
  else if (st.sceneIdx === SCENE_GREET) s.transcript.push({ who: 'sys', text: `☎️ ${s.speedSec}초 만에 전화를 받았습니다. 첫인사를 말해 주세요.` });
  const pl = parentLine(c, st.sceneIdx);
  if (pl) s.transcript.push({ who: 'parent', text: pl });
  render();
  window.scrollTo(0, document.body.scrollHeight);
  if (pl) Speech.speak(pl, Store.settings().rate);
}
function scriptSaid(said) {
  const s = app.session;
  s.answers[s.stepIdx].said = said;
  s.transcript.push({ who: 'me', text: said });
  s.phase = 'choose';
  render();
}
function submitChoice() {
  const s = app.session;
  const st = curStep();
  const c = caseById(st.caseId);
  const form = document.getElementById('choiceForm');
  const main = form.querySelector('input[name="opt"]:checked');
  const sub = form.querySelector('input[name="sub"]:checked');
  const ans = s.answers[s.stepIdx];
  // 안내 문구를 띄우며 다시 그려도 이미 고른 것은 남겨 둔다
  ans.optId = main ? main.value : null;
  ans.subId = sub ? sub.value : null;
  if (!main) { s.choiceErr = '가장 가까운 응답을 하나 골라 주세요.'; render(); return; }
  if (s.subOrders[s.stepIdx] && !sub) { s.choiceErr = SUB_TEXT[st.sceneIdx].err; render(); return; }
  s.phase = 'reacted';
  s.choiceErr = '';
  const o = optionsFor(c, st.sceneIdx).find(x => x.id === ans.optId);
  const lines = [reactionOf(c, st.sceneIdx, o, 'main')];
  s.transcript.push({ who: 'parent', text: lines[0] });
  if (ans.subId) {
    const so = subOptionsFor(st.sceneIdx).find(x => x.id === ans.subId);
    if (st.sceneIdx === SCENE_INTAKE && so.id !== 'c') {
      s.transcript.push({ who: 'me', text: '(이전 상담 경험) ' + so.text });
      s.transcript.push({ who: 'parent', text: reactionOf(c, st.sceneIdx, so, 'sub') });
      lines.push(reactionOf(c, st.sceneIdx, so, 'sub'));
    } else {
      s.transcript.push({ who: 'sys', text: so.r });
    }
  }
  render();
  window.scrollTo(0, document.body.scrollHeight);
  (async () => { for (const l of lines) await Speech.speak(l, Store.settings().rate); })();
}
function nextScene() {
  const s = app.session;
  Speech.stopSpeaking();
  if (s.stepIdx < s.steps.length - 1) { s.stepIdx++; enterScene(); }
  else finishScript();
}
function finishScript() {
  const s = app.session;
  s.elapsed = Date.now() - s.startTime;
  const items = {}, intake = {}, sceneScores = [];
  s.steps.forEach((st, i) => {
    const c = caseById(st.caseId);
    const ans = s.answers[i];
    const got = Object.assign({}, optionsFor(c, st.sceneIdx).find(o => o.id === ans.optId).s);
    if (s.mode === 'script' && st.sceneIdx === SCENE_GREET) got.speed = speedScore(s.speedSec);
    if (ans.subId) Object.assign(got, subOptionsFor(st.sceneIdx).find(o => o.id === ans.subId).s);
    sceneScores.push(got);
    Object.entries(got).forEach(([k, v]) => {
      if (INTAKE_BY_KEY[k]) { intake[k] = v; return; }
      if (!items[k]) items[k] = { score: 0, max: 0 };
      items[k].score += v;
      items[k].max += RUBRIC.find(r => r.key === k).max;
    });
  });
  const total = Object.values(items).reduce((a, it) => a + it.score, 0);
  s.result = { items, total, areas: areasOf(items), intake, sceneScores };
  saveRecord(s);
  app.resultTab = 'score';
  go('result');
}

/* =========================================================
   8. 기록 저장
   ========================================================= */
function saveRecord(s) {
  const r = s.result;
  const rec = {
    id: s.id, at: new Date().toISOString(), mode: s.mode,
    caseId: s.caseId, caseTitle: s.caseId ? caseById(s.caseId).title : '상담목표설정 집중 연습',
    total: r.total,
    max: Object.values(r.items).reduce((a, it) => a + it.max, 0),
    items: Object.fromEntries(Object.entries(r.items).map(([k, v]) => [k, v.score])),
    intake: r.intake || null,
    checklist: r.checklist || null,
    good: s.eval ? s.eval.good : [], improve: s.eval ? s.eval.improve : [],
    transcript: s.transcript.filter(t => t.who !== 'sys')
  };
  s.saved = Store.addRecord(rec);
}

/* =========================================================
   9. 화면 전환
   ========================================================= */
function go(screen) {
  app.screen = screen;
  render();
  window.scrollTo(0, 0);
}
function goHome() {
  stopMic();
  Speech.stopRing();
  Speech.stopSpeaking();
  app.session = null;
  go('home');
}
function inPractice() { return ['ring', 'call', 'script', 'evaluating'].includes(app.screen); }

function render() {
  const root = document.getElementById('app');
  const views = { home: viewHome, settings: viewSettings, history: viewHistory, ring: viewRing, call: viewCall, script: viewScript, evaluating: viewEvaluating, result: viewResult };
  root.innerHTML = views[app.screen]();
  if (['ring', 'call', 'script'].includes(app.screen)) startClock(); else stopClock();
}

/* =========================================================
   10. 화면: 첫 화면
   ========================================================= */
function viewHome() {
  const st = Store.settings();
  const recs = Store.records();
  const recent = recs.slice(0, 3).map(r => `<li>${fmtDate(r.at)} · ${MODE_LABEL[r.mode]} · ${esc(r.caseTitle)} · <b>${r.total}/${r.max}</b></li>`).join('');
  const caseRows = CASES.map(c => `
    <div class="case-item">
      <div><div class="title">${esc(c.title)}${c.crisis ? '<span class="tag crisis">위기 사례</span>' : ''}</div>
      <div class="meta">${esc(c.who)} · 약 ${c.minutes}분</div></div>
      <button class="btn" data-act="pick" data-id="${c.id}">시작</button>
    </div>`).join('');
  return `
    <header class="top">
      <div><h1>📞 보호자 전화상담 연습실</h1><p class="sub">대본 없이, 실제 전화처럼 내 말로 연습해요</p></div>
      <button class="icon-btn" data-act="settings" aria-label="설정">⚙</button>
    </header>
    ${Store.ok ? '' : '<div class="notice warn">이 브라우저에서는 저장 기능을 쓸 수 없어 기록과 설정이 남지 않아요. 시크릿 모드라면 일반 창으로 열어 주세요.</div>'}
    <div class="notice"><ul>
      <li><b>가상 사례</b>로 하는 연습입니다. 실제 인물 정보는 말하지 마세요.</li>
      <li>점수는 <b>참고용</b>이며 공식 평가가 아닙니다.</li>
      <li>기록은 <b>내 휴대폰에만</b> 저장됩니다.</li>
    </ul></div>
    <section class="card">
      <h2>연습 모드</h2>
      <div class="seg" role="radiogroup" aria-label="연습 모드">
        <button role="radio" aria-checked="${st.mode === 'ai'}" class="${st.mode === 'ai' ? 'on' : ''}" data-act="mode" data-mode="ai">🤖 AI 대화 모드<small>선택지 없이 자유 대화</small></button>
        <button role="radio" aria-checked="${st.mode === 'script'}" class="${st.mode === 'script' ? 'on' : ''}" data-act="mode" data-mode="script">📄 대본 모드<small>말한 뒤 보기 고르기</small></button>
      </div>
      ${st.mode === 'ai' && !Store.apiKey() ? '<p class="hint warn-text">AI 대화 모드는 API 키가 필요해요. ⚙설정에서 입력해 주세요.</p>' : ''}
    </section>
    <section class="card center">
      <button class="btn btn-call" data-act="random">📞 전화 받기</button>
      <p class="hint">어떤 전화가 올지 모릅니다. 벨이 울리면 5초 안에 받아 주세요.</p>
      <details class="pick">
        <summary>사례 골라서 연습</summary>
        <div class="case-list">${caseRows}</div>
      </details>
    </section>
    <section class="card">
      <h2>📈 내 연습 기록</h2>
      ${recs.length ? `<ul class="plain">${recent}</ul>` : '<p class="hint">아직 기록이 없어요. 첫 전화를 받아 보세요!</p>'}
      <button class="btn-ghost" data-act="history">전체 기록 보기</button>
    </section>
    <section class="card">
      <h2>🎯 상담목표설정 집중 연습</h2>
      <p>2025년 전화상담 모니터링에서 '상담목표설정'은 만족도가 낮았던 항목입니다. 사례 4개의 '상담 주제 정하기' 장면만 말로 연습합니다.</p>
      <button class="btn" data-act="focus">집중 연습 시작</button>
    </section>
    <section class="card">
      <h2>📋 평가지표</h2>
      <button class="btn-ghost" data-act="rubric">평가지표 보기</button>
    </section>`;
}

/* =========================================================
   11. 화면: 설정
   ========================================================= */
function viewSettings() {
  const st = Store.settings();
  const key = Store.apiKey();
  const isPreset = AI_MODELS.some(m => m.id === st.model);
  return `
    <header class="top"><div><h1>⚙ 설정</h1></div><button class="btn-ghost" data-act="home">← 처음으로</button></header>
    ${app.settingsMsg ? `<div class="notice warn" role="status">${esc(app.settingsMsg)}</div>` : ''}
    <section class="card">
      <h2>AI 대화 모드 (Google Gemini API)</h2>
      <p class="hint">API 키는 <b>이 휴대폰에만</b> 저장되고, AI에게 말을 보낼 때만 쓰입니다. 키 발급 방법은 함께 드린 안내서를 보세요.</p>
      <p>현재 상태: ${key ? `<b>키 저장됨</b> (····${esc(key.slice(-4))})` : '<b>키 없음</b>'}</p>
      <label class="field" for="apiKey">API 키 ${key ? '바꾸기' : '입력'}</label>
      <input id="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="AI Studio에서 받은 키를 붙여 넣으세요">
      <div class="row" style="margin-top:8px">
        <button class="btn" data-act="saveKey">저장</button>
        <button class="btn-ghost" data-act="testKey" ${key ? '' : 'disabled'}>연결 확인</button>
        <button class="btn-ghost danger" data-act="deleteKey" ${key ? '' : 'disabled'}>키 삭제</button>
      </div>
      <label class="field" for="model">AI 모델</label>
      <select id="model" data-change="model">
        ${AI_MODELS.map(m => `<option value="${m.id}" ${st.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        <option value="__custom" ${isPreset ? '' : 'selected'}>직접 입력</option>
      </select>
      ${isPreset ? '' : `<input id="customModel" type="text" value="${esc(st.model)}" data-change="customModel" placeholder="모델 이름">`}
      <p class="hint">무료 등급에서는 대화 내용이 구글 제품 개선에 쓰일 수 있어요. <a href="#" data-act="consentInfo">자세히</a></p>
    </section>
    <section class="card">
      <h2>음성</h2>
      <label class="field" for="rate">보호자 말하기 속도: <b id="rateVal">${st.rate.toFixed(1)}</b>배</label>
      <input id="rate" type="range" min="0.6" max="1.6" step="0.1" value="${st.rate}" data-change="rate">
      <button class="btn-ghost" data-act="previewVoice">들어 보기</button>
      ${Speech.ttsSupported ? '' : '<p class="hint warn-text">이 브라우저는 글자 읽기 기능이 없어 보호자 말이 소리로 나오지 않아요.</p>'}
      ${Speech.sttSupported ? '' : '<p class="hint warn-text">이 브라우저는 음성 인식이 없어 글자로만 입력할 수 있어요. 안드로이드 크롬을 써 주세요.</p>'}
      <label class="check"><input type="checkbox" data-change="captions" ${st.captions ? 'checked' : ''}> 보호자 말을 글자(자막)로도 보기</label>
      <label class="check"><input type="checkbox" data-change="autoSend" ${st.autoSend ? 'checked' : ''}> 말이 끝나면 확인 없이 바로 보내기</label>
    </section>
    <section class="card">
      <h2>기록</h2>
      <p>저장된 연습 기록: <b>${Store.records().length}</b>개</p>
      <button class="btn-ghost danger" data-act="deleteAll" ${Store.records().length ? '' : 'disabled'}>기록 전체 삭제</button>
    </section>`;
}

/* =========================================================
   12. 화면: 기록
   ========================================================= */
function viewHistory() {
  const recs = Store.records();
  const caseRecs = recs.filter(r => r.mode !== 'focus').slice(0, 5).reverse();
  const trend = caseRecs.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>항목</th>${caseRecs.map(r => `<th class="num">${fmtDate(r.at).split(' ')[0]}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><td><b>총점</b></td>${caseRecs.map(r => `<td class="num"><b>${r.total}</b></td>`).join('')}</tr>
        ${RUBRIC.map(it => `<tr><td>${esc(it.name)}</td>${caseRecs.map(r => `<td class="num">${r.items[it.key] !== undefined ? r.items[it.key] : '-'}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
    <p class="hint">최근 5회(집중 연습 제외) 항목별 점수입니다. 왼쪽이 오래된 기록이에요.</p>` : '<p class="hint">아직 비교할 기록이 없어요.</p>';
  const list = recs.map(r => `
    <div class="rec">
      <button class="rec-head" data-act="toggleRec" data-id="${r.id}" aria-expanded="${app.historyOpen === r.id}">
        <span>${fmtDate(r.at)} · ${MODE_LABEL[r.mode]} · ${esc(r.caseTitle)}</span><b>${r.total}/${r.max}</b>
      </button>
      ${app.historyOpen === r.id ? `
        <div class="rec-body">
          ${r.intake ? `<p class="hint">접수 확인: 청소년 동의 ${MARK[r.intake.consent]} · 이전 상담 ${MARK[r.intake.history]}</p>` : ''}
          ${r.good && r.good.length ? `<p><b>잘한 점</b></p><ul>${r.good.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
          ${r.improve && r.improve.length ? `<p><b>고칠 점</b></p><ul>${r.improve.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
          <details><summary>대화 내용 보기</summary>${transcriptHtml(r.transcript, true)}</details>
          <button class="btn-ghost danger" data-act="deleteRec" data-id="${r.id}">이 기록 삭제</button>
        </div>` : ''}
    </div>`).join('');
  return `
    <header class="top"><div><h1>📈 내 연습 기록</h1><p class="sub">이 휴대폰에만 저장되어 있어요</p></div><button class="btn-ghost" data-act="home">← 처음으로</button></header>
    <section class="card"><h2>항목별 변화</h2>${trend}</section>
    <section class="card"><h2>전체 기록 (${recs.length})</h2>${list || '<p class="hint">기록이 없어요.</p>'}</section>`;
}

/* =========================================================
   13. 화면: 벨 울림
   ========================================================= */
function viewRing() {
  const s = app.session;
  const c = caseById(s.caseId);
  return `
    ${practiceHead(s, c)}
    <section class="card ring">
      <div class="phone" aria-hidden="true">📞</div>
      <p><b>전화가 울리고 있습니다</b></p>
      <p class="hint">5초 안에 받으면 '수신의 신속성' 5점 (연습용 기준)</p>
      <button class="btn btn-call" data-act="answer">전화 받기</button>
      ${!s.random && c.crisis ? `<div class="notice crisis" style="margin-top:16px">${esc(c.crisisNote)}</div>` : ''}
    </section>`;
}

function practiceHead(s, c) {
  const title = s.mode === 'focus' ? '🎯 상담목표설정 집중 연습' : (s.random && app.screen === 'ring' ? '전화가 왔어요' : esc(c.title));
  const sub = s.mode === 'focus' ? `사례 ${s.stepIdx + 1} / ${s.steps.length}`
    : `${MODE_LABEL[s.mode]} 모드${s.mode === 'script' && app.screen === 'script' ? ` · 장면 ${s.stepIdx + 1} / ${s.steps.length}` : ''}${app.screen === 'ring' || s.random ? '' : ' · ' + esc(c.who)}`;
  return `
    <header class="top">
      <div><h1>${title}</h1><p class="sub">${sub}</p></div>
      <button class="btn-ghost" data-act="quit">그만하기</button>
    </header>
    <div class="clockbar">경과 <b id="clock">${fmtTime(Date.now() - (s.startTime || Date.now()))}</b> · 권장 ${RECOMMENDED_MINUTES}분</div>
    <div id="toastSlot">${s.warned15 ? toast15() : ''}</div>`;
}
function toast15() { return `<div class="toast">⏰ 권장 시간 ${RECOMMENDED_MINUTES}분이 지났어요. 실제 통화라면 마무리를 준비할 때예요.</div>`; }

/* =========================================================
   14. 화면: AI 통화
   ========================================================= */
function viewCall() {
  const s = app.session;
  const c = caseById(s.caseId);
  let tail = '';
  if (s.busy) tail = '<div class="bubble sys typing">보호자가 말하는 중…</div>';
  if (s.err) tail = `<div class="notice warn" role="alert">${esc(s.err)}<div class="row" style="margin-top:8px"><button class="btn" data-act="retryReply">다시 시도</button></div></div>`;
  return `
    ${practiceHead(s, c)}
    <section class="card call">
      <div class="convo">${transcriptHtml(s.transcript)}${tail}</div>
      ${s.parentEnded ? '' : (s.busy || s.err ? '' : micHtml(s))}
      <div class="row end" style="margin-top:12px"><button class="btn btn-end" data-act="endCall">📵 통화 종료</button></div>
    </section>`;
}

function transcriptHtml(list, forceCaptions) {
  const captions = forceCaptions || Store.settings().captions;
  return list.map((t, i) => {
    if (t.who === 'sys') return `<div class="bubble sys">${esc(t.text)}</div>`;
    if (t.who === 'me') return `<div class="bubble me"><span class="who">나</span>${esc(t.text)}</div>`;
    return `<div class="bubble parent"><span class="who">보호자 ${forceCaptions ? '' : `<button class="replay" data-act="replay" data-i="${i}" aria-label="다시 듣기">🔊</button>`}</span>${captions ? esc(t.text) : '<span class="hint">(자막 꺼짐 · 🔊를 눌러 다시 듣기)</span>'}</div>`;
  }).join('');
}

function micHtml(s) {
  const err = s.micErr ? `<p class="err" role="alert">${esc(s.micErr)}</p>` : '';
  const note = '<p class="hint">⚠️ 실제 인물의 이름·연락처·학교명은 말하지 마세요.</p>';
  if (s.listening) {
    return `<div class="mic">
      <div class="interim" id="interim">${esc(s.interim || '듣고 있어요…')}</div>
      <button class="btn btn-mic on" data-act="micStop">■ 다 말했어요</button>
      ${err}</div>`;
  }
  if (s.draft !== null || !Speech.sttSupported) {
    return `<div class="mic">
      ${Speech.sttSupported ? '<p class="hint">알아들은 내용이에요. 틀린 글자는 고친 뒤 보내세요.</p>' : '<p class="hint">이 브라우저는 음성 인식이 없어 글자로 입력해요.</p>'}
      <textarea id="draft" maxlength="600" placeholder="내가 할 말을 입력하세요">${esc(s.draft || '')}</textarea>
      <div class="row end">
        ${Speech.sttSupported ? '<button class="btn-ghost" data-act="micStart">🎙 다시 말하기</button>' : ''}
        <button class="btn" data-act="sendDraft">보내기</button>
      </div>${err}${note}</div>`;
  }
  return `<div class="mic">
    <button class="btn btn-mic" data-act="micStart">🎙 말하기</button>
    <p class="hint">누르고 말한 뒤, 다 말했으면 한 번 더 누르세요. · <a href="#" data-act="typeInstead">⌨ 글자로 입력</a></p>
    ${err}${note}</div>`;
}

/* =========================================================
   15. 화면: 대본 연습
   ========================================================= */
function viewScript() {
  const s = app.session;
  const st = curStep();
  const c = caseById(st.caseId);
  const meta = SCENE_META[st.sceneIdx];
  const isLast = s.stepIdx === s.steps.length - 1;
  const showCase = s.mode === 'focus' || !s.random;
  const head = practiceHead(s, c);

  let action = '';
  if (s.phase === 'speak') {
    action = `<p class="phase">① 먼저 <b>내 말로</b> 대답해 보세요. 보기는 말한 뒤에 나와요.</p>${micHtml(s)}`;
  } else if (s.phase === 'choose') {
    action = `<p class="phase">② 방금 한 말과 <b>가장 가까운 것</b>을 고르세요.</p>${choiceHtml(s, st, c)}`;
  } else {
    action = `<div class="row end"><button class="btn" data-act="nextScene">${isLast ? '결과 보기' : '다음 장면 →'}</button></div>`;
  }
  return `${head}
    <section class="card">
      <h2 class="scene-title">${s.mode === 'focus' ? `${esc(c.title)} · 상담 주제 정하기` : `장면 ${st.sceneIdx + 1}. ${esc(meta.title)}`}</h2>
      ${showCase && s.mode !== 'focus' && st.sceneIdx === SCENE_GREET ? `<p class="hint">${esc(c.intro)}</p>` : ''}
      <div class="convo">${transcriptHtml(sceneTranscript(s))}</div>
      ${action}
    </section>`;
}
/* 대본 모드에서는 지금 장면의 대화만 보여 준다 */
function sceneTranscript(s) {
  const idx = s.sceneStart && s.sceneStart[s.stepIdx];
  return s.transcript.slice(idx || 0);
}
function choiceHtml(s, st, c) {
  const opts = optionsFor(c, st.sceneIdx);
  const ans = s.answers[s.stepIdx];
  const main = s.orders[s.stepIdx].map((id, i) => {
    const o = opts.find(x => x.id === id);
    return `<label class="opt"><input type="radio" name="opt" value="${id}" ${ans.optId === id ? 'checked' : ''}><span><b>${'ABCD'[i]}.</b> ${esc(o.text)}</span></label>`;
  }).join('');
  let sub = '';
  if (s.subOrders[s.stepIdx]) {
    const subs = subOptionsFor(st.sceneIdx);
    sub = `<fieldset><legend>${esc(SUB_TEXT[st.sceneIdx].sub)}</legend>` + s.subOrders[s.stepIdx].map((id, i) => {
      const o = subs.find(x => x.id === id);
      return `<label class="opt"><input type="radio" name="sub" value="${id}" ${ans.subId === id ? 'checked' : ''}><span>${st.sceneIdx === SCENE_INTAKE ? `<b>${'ABC'[i]}.</b> ` : ''}${esc(o.text)}</span></label>`;
    }).join('') + '</fieldset>';
  }
  return `<form id="choiceForm" onsubmit="return false">
    <fieldset><legend>${SUB_TEXT[st.sceneIdx] ? esc(SUB_TEXT[st.sceneIdx].main) : '가장 가까운 응답'}</legend>${main}</fieldset>
    ${sub}
    ${s.choiceErr ? `<p class="err" role="alert">${esc(s.choiceErr)}</p>` : ''}
    <div class="row end"><button class="btn" data-act="submitChoice">선택 완료</button></div>
  </form>`;
}

/* =========================================================
   16. 화면: 채점 중
   ========================================================= */
function viewEvaluating() {
  const s = app.session;
  if (s.evalErr) {
    return `<header class="top"><div><h1>채점하지 못했어요</h1></div></header>
      <section class="card">
        <div class="notice warn" role="alert">${esc(s.evalErr)}</div>
        <p>통화 내용은 아직 화면에 남아 있어요. 다시 채점하거나, 저장하지 않고 처음으로 갈 수 있어요.</p>
        <div class="row"><button class="btn" data-act="retryEval">다시 채점</button><button class="btn-ghost" data-act="discard">저장하지 않고 처음으로</button></div>
        <details style="margin-top:12px"><summary>통화 내용 보기</summary>${transcriptHtml(s.transcript, true)}</details>
      </section>`;
  }
  return `<header class="top"><div><h1>채점하는 중…</h1></div></header>
    <section class="card center"><div class="spinner" aria-hidden="true"></div><p>AI가 평가지표로 통화를 살펴보고 있어요. 10~30초 정도 걸려요.</p></section>`;
}

/* =========================================================
   17. 화면: 결과
   ========================================================= */
function viewResult() {
  const s = app.session;
  const r = s.result;
  const c = s.caseId ? caseById(s.caseId) : null;
  const tab = app.resultTab;
  const title = c ? `${esc(c.title)} · 연습 결과` : '상담목표설정 집중 연습 · 결과';
  const body = tab === 'score' ? scorePanel(s, r, c) : (s.mode === 'ai' ? aiFeedbackPanel(s, c) : scriptFeedbackPanel(s));
  return `
    <header class="top"><div><h1>${title}</h1><p class="sub">${MODE_LABEL[s.mode]}${s.saved ? ' · 기록에 저장했어요' : ' · ⚠️ 저장하지 못했어요'}</p></div></header>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="${tab === 'score'}" class="${tab === 'score' ? 'on' : ''}" data-act="tab" data-tab="score">① 평가 결과</button>
      <button role="tab" aria-selected="${tab === 'fb'}" class="${tab === 'fb' ? 'on' : ''}" data-act="tab" data-tab="fb">② 개선 피드백</button>
    </div>
    <section class="card tab-panel" role="tabpanel">${body}</section>
    <div class="row">
      ${c ? `<button class="btn" data-act="again">이 사례 다시 연습</button>` : '<button class="btn" data-act="focus">집중 연습 다시 하기</button>'}
      <button class="btn-ghost" data-act="home">처음으로</button>
    </div>`;
}

function scorePanel(s, r, c) {
  const max = Object.values(r.items).reduce((a, it) => a + it.max, 0);
  const pct = Math.round((r.total / max) * 100);
  const g = gradeOf(pct);
  let goodBad;
  if (s.mode === 'ai') {
    goodBad = `<div class="two-col">
      <div class="box good"><h3>👍 잘한 점</h3>${listOrHint(s.eval.good, '')}</div>
      <div class="box fix"><h3>🔧 고칠 점</h3>${listOrHint(s.eval.improve, '')}</div></div>`;
  } else {
    const full = RUBRIC.filter(it => r.items[it.key] && r.items[it.key].score === r.items[it.key].max);
    const fix = RUBRIC.filter(it => r.items[it.key] && r.items[it.key].score < r.items[it.key].max);
    goodBad = `<div class="two-col">
      <div class="box good"><h3>👍 잘한 항목 (만점)</h3>${listOrHint(full.map(it => it.name), '아직 만점 항목이 없어요.')}</div>
      <div class="box fix"><h3>🔧 보완할 항목</h3>${listOrHint(fix.map(it => `${it.name} (${r.items[it.key].score}/${r.items[it.key].max})`), '모든 항목이 만점이에요!')}</div></div>`;
  }
  const checklist = r.checklist ? `
    <h3>위기 사례 체크리스트 <span class="hint">(매뉴얼 기반 · 참고용)</span></h3>
    <table><tbody>${PERSONAS[c.id].checklist.map(it => `<tr><td>${esc(it.name)}</td><td class="num">${r.checklist[it.key] ? '✅' : '❌'}</td></tr>`).join('')}</tbody></table>` : '';
  return `
    <div class="notice warn">${s.mode === 'ai' ? '<b>AI가 매긴 참고 점수</b>입니다. AI 판단은 틀릴 수 있으며' : '<b>자기점검용 참고 점수</b>이며'} 공식 평가 결과가 아닙니다.</div>
    <div class="score-hero">
      <div class="big">${r.total}<small> / ${max}점</small></div>
      <div><span class="grade ${g.cls}">${g.label}</span>${max !== 100 ? ` <span class="hint">(100점 환산 ${pct}점)</span>` : ''}<br><span class="hint">연습 시간 ${fmtTime(s.elapsed)}${s.speedSec !== null ? ` · ${s.speedSec}초 만에 받음` : ''}</span></div>
    </div>
    ${s.mode === 'focus' ? '' : `<h3>영역별 점수</h3><table><tbody>${r.areas.map(a => `<tr><td>${esc(a.name)}</td><td class="num"><b>${a.score}</b> / ${a.max}</td></tr>`).join('')}</tbody></table>`}
    <h3>세부항목 점수</h3>
    <table><tbody>${RUBRIC.filter(it => r.items[it.key]).map(it => {
      const v = r.items[it.key], p = Math.round((v.score / v.max) * 100);
      return `<tr><td>${esc(it.name)}<div class="mini-bar ${p < 100 ? 'low' : ''}"><span style="width:${p}%"></span></div></td><td class="num"><b>${v.score}</b> / ${v.max}</td></tr>`;
    }).join('')}</tbody></table>
    ${goodBad}
    ${r.intake && Object.keys(r.intake).length ? `<h3>기관 접수 확인 <span class="hint">(평가지표 외 · 점수에 포함 안 함)</span></h3>
      <table><tbody>${INTAKE_CHECKS.map(it => `<tr><td>${esc(it.name)}</td><td class="num">${MARK[r.intake[it.key]]}</td></tr>`).join('')}</tbody></table>` : ''}
    ${checklist}
    ${c && c.crisis ? `<div class="notice crisis" style="margin-top:14px"><b>위기 사례 안내</b><br>${esc(c.crisisNote)}${s.mode === 'ai' ? ' AI 평가는 참고용입니다.' : ''}</div>` : ''}`;
}
function listOrHint(list, hint) {
  return list && list.length ? '<ul>' + list.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : `<p class="hint" style="margin:0">${esc(hint || '없음')}</p>`;
}

function aiFeedbackPanel(s, c) {
  const ev = s.eval;
  const cards = RUBRIC.map(it => {
    if (it.key === 'speed') return fbItem(it, s.result.items.speed.score, `벨이 울리고 ${s.speedSec}초 만에 받았어요. ${it.official}`, '', '');
    if (it.key === 'hangup') return fbItem(it, s.hangup, s.hangup ? '보호자가 먼저 끊을 때까지 기다렸어요.' : '보호자보다 먼저 통화를 끝냈어요. 보호자가 작별 인사를 하고 끊을 때까지 기다려 주세요.', '', '');
    const v = ev.items[it.key];
    return fbItem(it, v.score, v.reason, v.quote, v.better);
  }).join('');
  return `
    ${cards}
    ${reviewHtml(s, c)}
    <details class="fb-scene"><summary><b>통화 전체 내용</b></summary>${transcriptHtml(s.transcript.filter(t => t.who !== 'sys'), true)}</details>`;
}
function fbItem(it, score, reason, quote, better) {
  return `<div class="fb-scene">
    <h3><span>${esc(it.name)}</span><span class="pts">${score} / ${it.max}점</span></h3>
    <div class="crit">${esc(it.levels[score] || '')}</div>
    ${reason ? `<div class="fb-label">판단 근거</div><div>${esc(reason)}</div>` : ''}
    ${quote ? `<div class="fb-label">내가 한 말</div><div class="quote">${esc(quote)}</div>` : ''}
    ${better && score < it.max ? `<div class="fb-label">이렇게 말해 보세요</div><div class="quote model">${esc(better)}</div>` : ''}
  </div>`;
}

/* AI 모드 복습: 아쉬웠던 장면을 객관식으로 다시 풀기 */
function reviewHtml(s, c) {
  const weak = [];
  RUBRIC.forEach(it => {
    const sc = ITEM_TO_SCENE[it.key];
    if (sc !== undefined && s.result.items[it.key].score < it.max && !weak.includes(sc)) weak.push(sc);
  });
  if (!weak.length) return '<div class="box good"><h3>🎉 복습할 장면이 없어요</h3>모든 대화 항목이 만점이에요.</div>';
  s.review = s.review || {};
  s.reviewOrders = s.reviewOrders || {};
  const blocks = weak.slice(0, 3).map(sc => {
    const opts = optionsFor(c, sc);
    if (!s.reviewOrders[sc]) s.reviewOrders[sc] = shuffle(opts.map(o => o.id));
    const chosen = s.review[sc];
    const best = bestOf(opts);
    const pl = parentLine(c, sc);
    return `<div class="fb-scene">
      <h3><span>복습: ${esc(SCENE_META[sc].title)}</span></h3>
      ${pl ? `<div class="bubble parent"><span class="who">보호자</span>${esc(pl)}</div>` : '<p class="hint">전화를 받은 직후, 첫마디는?</p>'}
      ${s.reviewOrders[sc].map((id, i) => {
        const o = opts.find(x => x.id === id);
        const cls = chosen ? (id === best.id ? 'opt right' : (id === chosen ? 'opt wrong' : 'opt')) : 'opt';
        return `<button class="${cls}" data-act="review" data-scene="${sc}" data-id="${id}" ${chosen ? 'disabled' : ''}><span><b>${'ABCD'[i]}.</b> ${esc(o.text)}</span></button>`;
      }).join('')}
      ${chosen ? `<div class="fb-label">피드백</div><div>${esc(opts.find(o => o.id === chosen).fb)}</div>` : ''}
    </div>`;
  }).join('');
  return `<h3>🔁 복습: 아쉬웠던 장면 다시 풀기</h3>${blocks}`;
}

function scriptFeedbackPanel(s) {
  return s.steps.map((st, i) => {
    const c = caseById(st.caseId);
    const meta = SCENE_META[st.sceneIdx];
    const ans = s.answers[i];
    const got = s.result.sceneScores[i];
    const opts = optionsFor(c, st.sceneIdx);
    const chosen = opts.find(o => o.id === ans.optId);
    const subs = subOptionsFor(st.sceneIdx);
    const chosenSub = ans.subId ? subs.find(o => o.id === ans.subId) : null;
    const best = bestOf(opts);
    const bestSub = st.sceneIdx === SCENE_INTAKE && s.mode !== 'focus' ? bestOf(subs) : null;
    const rk = Object.keys(got).filter(k => RUBRIC.some(r => r.key === k));
    const pts = meta.intake ? '평가지표 외' : `${rk.reduce((a, k) => a + got[k], 0)} / ${rk.reduce((a, k) => a + RUBRIC.find(r => r.key === k).max, 0)}점`;
    const crit = RUBRIC.filter(r => r.key in got).map(r => `<div>· <b>${esc(r.name)} ${got[r.key]}/${r.max}</b> — ${esc(r.levels[got[r.key]])}</div>`)
      .concat(INTAKE_CHECKS.filter(r => r.key in got).map(r => `<div>· <b>${esc(r.name)} ${MARK[got[r.key]]}</b> — ${esc(r.levels[got[r.key]])}</div>`)).join('');
    const hints = (KEYWORD_HINTS[st.sceneIdx] || []).map(h => `<li>${h.re.test(ans.said) ? '✅' : '⬜'} ${esc(h.label)}</li>`).join('');
    return `<div class="fb-scene">
      <h3><span>${s.mode === 'focus' ? esc(c.title) + ' · 상담 주제 정하기' : `장면 ${st.sceneIdx + 1}. ${esc(meta.title)}`}</span><span class="pts">${pts}</span></h3>
      <div class="fb-label">내가 실제로 한 말</div><div class="quote">${esc(ans.said)}</div>
      ${hints ? `<div class="fb-label">핵심 단어 확인 <span class="hint">(참고용 · 음성 인식 결과 기준)</span></div><ul class="checks">${hints}</ul>` : ''}
      <div class="fb-label">내가 고른 가장 가까운 응답</div><div class="quote">${esc(chosen.text)}${chosenSub ? '<br>' + esc(chosenSub.text) : ''}</div>
      <div class="fb-label">평가 기준</div><div class="crit">${crit}</div>
      <div class="fb-label">피드백</div><div>${esc(chosen.fb)}</div>${chosenSub ? `<div>${esc(chosenSub.fb)}</div>` : ''}
      ${st.sceneIdx === SCENE_GREET && s.mode === 'script' ? `<div class="hint">☎️ ${s.speedSec}초 만에 받음</div>` : ''}
      <div class="fb-label">모범 응답</div><div class="quote model">${esc(best.text)}${bestSub ? '<br>' + esc(bestSub.text) : ''}</div>
      <div class="fb-label">스스로 점검해 보세요</div><ul class="checks">${meta.checks.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
    </div>`;
  }).join('');
}

/* =========================================================
   18. 팝업: 평가지표, AI 데이터 안내
   ========================================================= */
function openModal(html) {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-back" data-act="closeModal"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const btn = document.querySelector('#modalRoot .modal button');
  if (btn) btn.focus();
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

function openRubric() {
  const rows = RUBRIC.map(r => `<tr><td><b>${esc(r.name)}</b><br><span class="hint">${esc(r.area)} · ${r.max}점</span></td>
    <td class="crit">${Object.keys(r.levels).map(Number).sort((a, b) => b - a).map(sc => `<div><b>${sc}점</b> ${esc(r.levels[sc])}</div>`).join('')}</td></tr>`).join('');
  openModal(`<div class="modal-head"><h2>전화상담 평가지표 (100점)</h2><button class="btn-ghost" data-act="closeModal">닫기</button></div>
    <p class="hint">출처: 2025년 청소년상담1388(전화) 서비스 모니터링 평가지표</p>
    <div class="table-wrap"><table><tbody>${rows}</tbody></table></div>`);
}
function consentText() {
  return `<ul>
    <li>AI 대화 모드에서는 내가 한 말(글자)과 보호자 대화가 <b>Google Gemini API</b>로 보내집니다.</li>
    <li><b>무료 등급에서는 보낸 내용이 구글 제품 개선에 쓰일 수 있습니다.</b></li>
    <li>음성 인식은 크롬 기능을 쓰며, 목소리가 구글 서버를 거칠 수 있습니다.</li>
    <li>가상 사례 연습이므로 <b>실제 청소년·보호자의 이름, 연락처, 학교명, 상담 내용은 절대 말하지 마세요.</b></li>
    <li>AI의 대답과 채점은 틀릴 수 있으며, 위기 판단은 센터 절차와 슈퍼바이저를 따릅니다.</li>
  </ul>`;
}
function openConsent() {
  openModal(`<div class="modal-head"><h2>AI 대화 모드 사용 전 안내</h2></div>${consentText()}
    <div class="row end"><button class="btn-ghost" data-act="closeModal">취소</button><button class="btn" data-act="consentYes">이해했고 동의해요</button></div>`);
}

/* =========================================================
   19. 이벤트 처리
   ========================================================= */
const ACTIONS = {
  settings: () => { app.settingsMsg = ''; go('settings'); },
  history: () => go('history'),
  home: () => goHome(),
  mode: el => { Store.saveSettings({ mode: el.dataset.mode }); render(); },
  random: () => requestStart(null, true),
  pick: el => requestStart(el.dataset.id, false),
  focus: () => startFocus(),
  rubric: () => openRubric(),
  answer: () => answerCall(),
  quit: () => { if (window.confirm('연습을 그만둘까요? 이번 연습은 저장되지 않아요.')) goHome(); },
  micStart: () => startMic(),
  micStop: () => stopMic(),
  typeInstead: () => { app.session.draft = ''; render(); const t = document.getElementById('draft'); if (t) t.focus(); },
  sendDraft: () => sendSaid(document.getElementById('draft').value),
  replay: el => { const t = app.session.transcript[Number(el.dataset.i)]; if (t) Speech.speak(t.text, Store.settings().rate); },
  retryReply: () => requestParentReply(),
  endCall: () => endCall(),
  retryEval: () => runEvaluation(),
  discard: () => { if (window.confirm('통화 내용을 저장하지 않고 처음 화면으로 갈까요?')) goHome(); },
  submitChoice: () => submitChoice(),
  nextScene: () => nextScene(),
  tab: el => { app.resultTab = el.dataset.tab; render(); },
  again: () => { const s = app.session; Store.saveSettings({ mode: s.mode }); requestStart(s.caseId, false); },
  review: el => { app.session.review[el.dataset.scene] = el.dataset.id; render(); },
  toggleRec: el => { app.historyOpen = app.historyOpen === el.dataset.id ? null : el.dataset.id; render(); },
  deleteRec: el => { if (window.confirm('이 기록을 삭제할까요?')) { Store.deleteRecord(el.dataset.id); app.historyOpen = null; render(); } },
  deleteAll: () => { if (window.confirm('연습 기록을 모두 삭제할까요? 되돌릴 수 없어요.')) { Store.deleteAllRecords(); app.settingsMsg = '기록을 모두 삭제했어요.'; render(); } },
  saveKey: () => {
    const v = document.getElementById('apiKey').value.trim();
    if (!v) { app.settingsMsg = '붙여 넣은 키가 없어요.'; render(); return; }
    if (/\s/.test(v) || v.length < 20) { app.settingsMsg = '키 모양이 올바르지 않아요. 앞뒤 공백 없이 키 전체를 붙여 넣어 주세요.'; render(); return; }
    app.settingsMsg = Store.saveApiKey(v) ? '키를 저장했어요. [연결 확인]으로 작동하는지 확인해 보세요.' : '키를 저장하지 못했어요.';
    render();
  },
  deleteKey: () => { if (window.confirm('저장된 API 키를 이 휴대폰에서 삭제할까요?')) { Store.deleteApiKey(); app.settingsMsg = '키를 삭제했어요.'; render(); } },
  testKey: async () => {
    app.settingsMsg = '연결 확인 중…'; render();
    try { await AI.test(Store.apiKey(), Store.settings().model); app.settingsMsg = '✅ 연결되었어요. AI 대화 모드를 쓸 수 있어요.'; }
    catch (e) { app.settingsMsg = '❌ ' + e.message; }
    if (app.screen === 'settings') render();
  },
  previewVoice: () => Speech.speak('안녕하세요. 아이 문제로 상담을 받고 싶어서 전화드렸어요.', Store.settings().rate),
  consentInfo: () => openModal(`<div class="modal-head"><h2>AI 데이터 안내</h2><button class="btn-ghost" data-act="closeModal">닫기</button></div>${consentText()}`),
  consentYes: () => {
    Store.saveAiConsent(true);
    closeModal();
    const p = app.pendingStart; app.pendingStart = null;
    if (p) startPractice(p.caseId, p.random, 'ai');
  },
  closeModal: () => closeModal()
};

function handleClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.dataset.act === 'closeModal' && el.classList.contains('modal-back') && e.target !== el) return;
  if (el.tagName === 'A') e.preventDefault();
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el);
}
document.getElementById('app').addEventListener('click', handleClick);
document.getElementById('modalRoot').addEventListener('click', handleClick);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* 설정 값 바꾸기 */
document.getElementById('app').addEventListener('change', e => {
  const k = e.target.dataset.change;
  if (!k) return;
  if (k === 'model') {
    if (e.target.value === '__custom') Store.saveSettings({ model: '' }); else Store.saveSettings({ model: e.target.value });
    render();
  } else if (k === 'customModel') Store.saveSettings({ model: e.target.value.trim() });
  else if (k === 'rate') Store.saveSettings({ rate: Number(e.target.value) });
  else if (k === 'captions' || k === 'autoSend') Store.saveSettings({ [k]: e.target.checked });
});
document.getElementById('app').addEventListener('input', e => {
  if (e.target.id === 'rate') { const v = document.getElementById('rateVal'); if (v) v.textContent = Number(e.target.value).toFixed(1); }
  if (e.target.id === 'draft' && app.session) app.session.draft = e.target.value;
});

/* 경과 시간 (점수와 무관) */
function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    const s = app.session;
    if (!s || !s.startTime) return;
    const ms = Date.now() - s.startTime;
    const el = document.getElementById('clock');
    if (el) el.textContent = fmtTime(ms);
    if (!s.warned15 && ms >= RECOMMENDED_MINUTES * 60000) {
      s.warned15 = true;
      const slot = document.getElementById('toastSlot');
      if (slot) slot.innerHTML = toast15();
    }
  }, 1000);
}
function stopClock() { clearInterval(clockTimer); clockTimer = null; }

window.addEventListener('beforeunload', e => { if (inPractice()) { e.preventDefault(); e.returnValue = ''; } });

/* 오류 안내 */
function showError() {
  const b = document.getElementById('errorBanner');
  b.textContent = '문제가 생겨 화면을 표시하지 못했어요. 앱을 닫았다가 다시 열어 주세요.';
  b.style.display = 'block';
}
window.addEventListener('error', showError);
window.addEventListener('unhandledrejection', showError);

/* 설치형 웹앱: 인터넷이 끊겨도 화면이 열리도록 */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 기능만 빠짐 */ });
}

try { render(); } catch (err) { console.error(err); showError(); }
