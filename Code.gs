/**
 * Code.gs — 선택과목 교환 신청 웹앱 (서버) · 학생 직접 입력 방식
 * 학교 수강 명단을 올리지 않는다. 교환을 원하는 학생만 학번·이름과 바꿀 과목을 입력한다.
 * 1학년은 2학년 과목, 2학년은 3학년 과목만 바꿀 수 있다(Logic.gs allowedSems_).
 *
 * 속도를 위해
 *  - 학생 로그인은 서버 왕복 1번(로그인 + 첫 화면 데이터)
 *  - 학생 조회는 잠금·쓰기 없이 신청·매칭 시트 2개만 읽음
 *  - 과목·설정은 캐시(5분), 과목 고르기 검증은 브라우저에서 바로 처리
 *
 * 클라이언트에서 호출 가능한 함수: doGet, login, logout, stRegister, st*, tc*, ad*
 * 이름이 _ 로 끝나는 함수는 내부 전용(클라이언트에서 호출 불가)이다.
 */

var SHEETS = {
  '설정': ['키', '값', '설명'],
  '과목': ['과목코드', '학년', '학기', '선택군', '과목명', '표시명', '학점', '선수과목코드'],
  '교사': ['교사ID', '이름', '역할', '담당학년', '담당반', '비밀번호해시', '솔트'],
  '신청자': ['학번', '이름', '학년', '반', '번호', '비밀번호해시', '솔트', '등록시각', '동의시각'],
  '신청': ['신청ID', '학번', '학년', '학기', '선택군', '내는과목코드', '원하는과목코드', '연계묶음ID',
         '상태', '매칭ID', '신청시각', '담임확인', '위계응답'],
  '매칭': ['매칭ID', '유형', '학년', '학기', '선택군', '신청ID목록', '동의현황', '매칭시각', '동의기한',
         '상태', '승인시각', '대조확인', '메모'],
  '이력': ['시각', '작업자', '작업', '대상', '변경 전', '변경 후']
};
var SESSION_SEC = 1800;
var CACHE_SEC = 300;
var DEFAULT_NOTICE = '[개인정보 수집·이용 안내]\n' +
  '· 수집 항목: 학년·반·번호, 이름, 교환하려는 과목, 위계 확인 답변\n' +
  '· 수집 목적: 선택과목 교환 신청 접수와 매칭, 담임·교육과정부의 수강 기록 대조\n' +
  '· 보유 기간: 교환 기간 종료 후 일괄 삭제\n' +
  '· 동의하지 않을 수 있으며, 이 경우 담임 선생님께 직접 교환을 신청할 수 있습니다.';

/* ───────────── 웹앱 진입 ───────────── */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.boot = bootJson_();
  t.logic = clientLogic_();
  return t.evaluate()
    .setTitle('선택과목 교환 신청')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 첫 화면에 바로 넣는 데이터(과목표·신청 기간·안내문). 로그인 전 서버 호출을 없앤다 */
function bootJson_() {
  var st = settings_();
  return JSON.stringify({ courses: courses_(), open: isOpen_(st), start: st.start, end: st.end, notice: st.notice, classes: st.classes, maxNo: st.maxNo })
    .replace(/</g, '\\u003c');
}

/* ───────────── 시트 DB ───────────── */

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function tz_() { return Session.getScriptTimeZone() || 'Asia/Seoul'; }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('"' + name + '" 시트가 없습니다. 편집기에서 setup()을 먼저 실행하세요.');
  return sh;
}

function norm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function read_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (!values.length) return [];
  var head = values[0].map(norm_);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (x) { return x === '' || x === null; })) continue;
    var o = {};
    head.forEach(function (h, j) { if (h) o[h] = norm_(row[j]); });
    rows.push(o);
  }
  return rows;
}

function write_(name, rows) {
  var sh = sheet_(name);
  var head = SHEETS[name];
  var data = [head].concat(rows.map(function (r) {
    return head.map(function (h) { return r[h] === undefined || r[h] === null ? '' : String(r[h]); });
  }));
  sh.clearContents();
  var rng = sh.getRange(1, 1, data.length, head.length);
  rng.setNumberFormat('@');
  rng.setValues(data);
}

function append_(name, rows) {
  if (!rows.length) return;
  var sh = sheet_(name);
  var head = SHEETS[name];
  var data = rows.map(function (r) {
    return head.map(function (h) { return r[h] === undefined || r[h] === null ? '' : String(r[h]); });
  });
  var rng = sh.getRange(sh.getLastRow() + 1, 1, data.length, head.length);
  rng.setNumberFormat('@');
  rng.setValues(data);
}

function index_(rows, key) {
  var m = {};
  rows.forEach(function (r) { m[r[key]] = r; });
  return m;
}

function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function fmt_(ms) { return Utilities.formatDate(new Date(ms), tz_(), 'yyyy-MM-dd HH:mm:ss'); }

function parseTime_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

function newId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), tz_(), 'yyMMddHHmmss') +
    Utilities.getUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
}

/** 캐시에 있으면 캐시에서, 없으면 시트에서 읽고 캐시에 넣는다 */
function cached_(key, loader) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var v = loader();
  try { cache.put(key, JSON.stringify(v), CACHE_SEC); } catch (e) { /* 너무 크면 캐시 생략 */ }
  return v;
}
function clearCache_() { CacheService.getScriptCache().removeAll(['C_courses', 'C_settings']); }

function courses_() {
  return cached_('C_courses', function () {
    var map = {};
    read_('과목').forEach(function (c) { map[c.과목코드] = c; });
    return map;
  });
}

function log_(actor, action, target, before, after) {
  append_('이력', [{ 시각: now_(), 작업자: actor, 작업: action, 대상: target, '변경 전': before || '', '변경 후': after || '' }]);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('접속자가 많습니다. 잠시 후 다시 시도해 주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ───────────── 설정 ───────────── */

function settings_() {
  return cached_('C_settings', function () {
    var m = {};
    read_('설정').forEach(function (r) { m[r.키] = r.값; });
    return {
      start: m['신청시작'] || '',
      end: m['신청마감'] || '',
      agreeHours: Number(m['동의기한(시간)']) || 48,
      autoMatch: m['자동매칭'] === 'ON',
      autoHours: Number(m['자동매칭간격(시간)']) || 1,
      webUrl: m['웹앱주소'] || '',
      classes: Math.min(Math.max(Number(m['반 수']) || 12, 1), 30),
      maxNo: Math.min(Math.max(Number(m['반별 최대 번호']) || 40, 1), 60),
      notice: m['개인정보안내'] || DEFAULT_NOTICE
    };
  });
}

function isOpen_(st) {
  var s = parseTime_(st.start), e = parseTime_(st.end), now = Date.now();
  return !!(s && e && now >= s && now <= e);
}

/* ───────────── 보안 ───────────── */

function hash_(secret, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + secret, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

function randomPin_() {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random());
  var s = '';
  for (var i = 0; i < 4; i++) s += String(((bytes[i] + 256) % 256) % 10);
  return s;
}

function newSession_(user) {
  user.iat = Date.now();
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('S_' + token, JSON.stringify(user), SESSION_SEC);
  return token;
}

/**
 * 학생 접속 무효화(시트를 읽지 않고 캐시만 확인).
 * X_학번 에는 지금 유효한 솔트가 들어 있다. 비밀번호 재설정·등록 삭제 시 바뀌므로 이전 접속이 끊긴다.
 */
function setValidSalt_(sid, salt) { CacheService.getScriptCache().put('X_' + sid, salt, 21600); }

function auth_(token, roles) {
  if (!token) throw new Error('SESSION_EXPIRED');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('S_' + token);
  if (!raw) throw new Error('SESSION_EXPIRED');
  var u = JSON.parse(raw);
  if (u.role === 'student') {
    var valid = cache.get('X_' + u.id), purged = cache.get('X_ALL');
    if ((valid && valid !== u.salt) || (purged && +purged >= u.iat)) { cache.remove('S_' + token); throw new Error('SESSION_EXPIRED'); }
  }
  cache.put('S_' + token, raw, SESSION_SEC);
  if (roles && roles.indexOf(u.role) < 0) throw new Error('이 기능을 사용할 권한이 없습니다.');
  return u;
}

/** 실패 횟수(캐시). 5회 연속 실패 시 10분 잠금 */
function lockCheck_(key) {
  var f = JSON.parse(CacheService.getScriptCache().get(key) || '{"n":0}');
  if (f.until && f.until > Date.now()) {
    return '로그인 5회 실패로 잠겨 있습니다. ' + Math.ceil((f.until - Date.now()) / 60000) + '분 후 다시 시도하세요.';
  }
  return '';
}
function lockFail_(key, what) {
  var cache = CacheService.getScriptCache();
  var f = JSON.parse(cache.get(key) || '{"n":0}');
  f.n = (f.n || 0) + 1;
  var msg = what + '가 맞지 않습니다. (' + f.n + '/5)';
  if (f.n >= 5) { f = { n: 0, until: Date.now() + 600000 }; msg = '5회 연속 실패하여 10분간 로그인이 잠깁니다.'; }
  cache.put(key, JSON.stringify(f), 21600);
  return msg;
}

/** 학년·반·번호 → 내부 식별용 학번(학년1 + 반2 + 번호2). 학생은 드롭다운으로 고르기만 한다 */
function makeSid_(grade, cls, no) {
  var st = settings_();
  grade = String(grade || '').trim(); cls = Number(cls); no = Number(no);
  if (grade !== '1' && grade !== '2') return null;
  if (!(cls >= 1 && cls <= st.classes) || !(no >= 1 && no <= st.maxNo) || cls % 1 || no % 1) return null;
  return grade + ('0' + cls).slice(-2) + ('0' + no).slice(-2);
}

/** 내부 학번 → 학년·반·번호 */
function parseSid_(sid) {
  var m = String(sid || '').trim().match(/^([12])(\d{2})(\d{2})$/);
  if (!m || +m[2] < 1 || +m[3] < 1) return null;
  return { grade: m[1], cls: String(+m[2]), no: String(+m[3]) };
}

/**
 * 학생 '이어서 하기': 학번 + 이름 + 4자리 비밀번호 → 접속 + 첫 화면 데이터를 한 번에.
 * 교사: 교사ID + 비밀번호.
 */
function login(kind, id, secret, name) {
  if (kind === 'student' && id && typeof id === 'object') id = makeSid_(id.grade, id.cls, id.no) || '';
  id = String(id || '').trim();
  secret = String(secret || '').trim();
  if (!id || !secret) return { ok: false, msg: '모든 칸을 입력하세요.' };
  var key = 'F_' + kind + '_' + id;
  var locked = lockCheck_(key);
  if (locked) return { ok: false, msg: locked };
  var user = null;
  if (kind === 'student') {
    var a = read_('신청자').filter(function (r) { return r.학번 === id; })[0];
    if (!a) return { ok: false, msg: '등록되지 않은 학년·반·번호입니다. 처음이라면 "처음 신청하기"를 누르세요.' };
    if (hash_(secret, a.솔트) === a.비밀번호해시 && String(name || '').replace(/\s/g, '') === a.이름.replace(/\s/g, '')) {
      user = { role: 'student', id: a.학번, name: a.이름, grade: a.학년, cls: a.반, no: a.번호, salt: a.솔트 };
    }
  } else {
    var t = read_('교사').filter(function (r) { return r.교사ID === id; })[0];
    if (t && t.비밀번호해시 && hash_(secret, t.솔트) === t.비밀번호해시) {
      user = { role: t.역할 === '관리자' ? '관리자' : '담임', id: t.교사ID, name: t.이름, grade: t.담당학년, cls: t.담당반 };
    }
  }
  if (!user) return { ok: false, msg: lockFail_(key, kind === 'student' ? '이름 또는 비밀번호' : '교사ID 또는 비밀번호') };
  CacheService.getScriptCache().remove(key);
  if (user.role === 'student') setValidSalt_(user.id, user.salt);
  var token = newSession_(user);
  var out = { ok: true, token: token, user: publicUser_(user) };
  if (user.role === 'student') out.home = studentView_(user);
  return out;
}
function publicUser_(u) { return { role: u.role, id: u.id, name: u.name, grade: u.grade, cls: u.cls, no: u.no }; }

function logout(token) {
  if (token) CacheService.getScriptCache().remove('S_' + token);
  return true;
}

/** 학생 '처음 신청하기': 학번에서 학년·반·번호를 읽고, 비밀번호를 정해 등록 */
function stRegister(info) {
  info = info || {};
  var sid = makeSid_(info.grade, info.cls, info.no);
  var name = String(info.name || '').trim();
  var pin = String(info.pin || '').trim();
  if (!sid) throw new Error('학년·반·번호를 모두 고르세요. 교환 신청은 1·2학년만 할 수 있습니다.');
  var p = parseSid_(sid);
  if (!name || name.length > 20) throw new Error('이름을 입력하세요.');
  if (!/^\d{4}$/.test(pin)) throw new Error('비밀번호는 숫자 4자리로 정하세요.');
  if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '0000') throw new Error('너무 쉬운 비밀번호입니다(같은 숫자 4개, 1234 등). 다른 숫자로 정하세요.');
  if (!info.agree) throw new Error('개인정보 수집·이용에 동의해야 신청할 수 있습니다.');
  if (!isOpen_(settings_())) throw new Error('지금은 신청 기간이 아닙니다.');
  return withLock_(function () {
    if (read_('신청자').some(function (r) { return r.학번 === sid; })) {
      throw new Error(p.grade + '학년 ' + p.cls + '반 ' + p.no + '번은 이미 등록되어 있습니다. 전에 신청했다면 "이어서 하기"로 들어가세요. 등록한 적이 없다면 담임 선생님께 알려주세요.');
    }
    var salt = Utilities.getUuid();
    var nowS = now_();
    append_('신청자', [{ 학번: sid, 이름: name, 학년: p.grade, 반: p.cls, 번호: p.no, 비밀번호해시: hash_(pin, salt), 솔트: salt, 등록시각: nowS, 동의시각: nowS }]);
    log_(sid, '학생 등록', sid, '', p.grade + '학년 ' + p.cls + '반');
    setValidSalt_(sid, salt);
    var user = { role: 'student', id: sid, name: name, grade: p.grade, cls: p.cls, no: p.no, salt: salt };
    var token = newSession_(user);
    return { ok: true, token: token, user: publicUser_(user), home: studentView_(user) };
  });
}

/* ───────────── 흐름 데이터(신청·매칭) ───────────── */

function loadFlow_() { return { reqs: read_('신청'), matches: read_('매칭') }; }
function saveFlow_(db) { write_('신청', db.reqs); write_('매칭', db.matches); }
function ids_(m) { return String(m.신청ID목록 || '').split(',').filter(String); }
function agree_(m) { try { return JSON.parse(m.동의현황 || '{}'); } catch (e) { return {}; } }
function answersOf_(r) { try { return JSON.parse(r.위계응답 || '{}'); } catch (e) { return {}; } }
function toSwap_(r) { return { give: r.내는과목코드, want: r.원하는과목코드 }; }
function bundleReqs_(db, bid) { return db.reqs.filter(function (x) { return x.연계묶음ID === bid; }); }
function revalidate_(db, courses, r) {
  var group = r.연계묶음ID ? bundleReqs_(db, r.연계묶음ID) : [r];
  return validateDeclared_(courses, group.map(toSwap_), answersOf_(group[0]));
}

function dissolve_(db, startMatchIds, culpritIds, culpritStatus, actor, reason) {
  var mById = index_(db.matches, '매칭ID'), rById = index_(db.reqs, '신청ID');
  var culprit = {};
  culpritIds.forEach(function (id) {
    var r = rById[id]; if (!r) return;
    culprit[id] = true;
    if (r.연계묶음ID) bundleReqs_(db, r.연계묶음ID).forEach(function (x) { culprit[x.신청ID] = true; });
  });
  var queue = startMatchIds.slice();
  Object.keys(culprit).forEach(function (id) { if (rById[id].매칭ID) queue.push(rById[id].매칭ID); });
  var hit = {};
  while (queue.length) {
    var mid = queue.pop();
    if (hit[mid] || !mById[mid] || MAT_LIVE.indexOf(mById[mid].상태) < 0) continue;
    hit[mid] = true;
    ids_(mById[mid]).forEach(function (rid) {
      var r = rById[rid];
      if (r && r.연계묶음ID) bundleReqs_(db, r.연계묶음ID).forEach(function (x) { if (x.매칭ID) queue.push(x.매칭ID); });
    });
  }
  Object.keys(hit).forEach(function (mid) {
    var m = mById[mid];
    m.상태 = culpritStatus === REQ.REJECTED ? MAT.REJECTED : MAT.DISSOLVED;
    m.메모 = reason;
    ids_(m).forEach(function (rid) {
      var r = rById[rid]; if (!r) return;
      r.매칭ID = '';
      r.상태 = culprit[rid] ? culpritStatus : REQ.WAIT;
    });
  });
  Object.keys(culprit).forEach(function (id) { rById[id].상태 = culpritStatus; rById[id].매칭ID = ''; });
  log_(actor, '매칭 해제', Object.keys(hit).join(',') || '-', reason,
    '책임 신청 ' + Object.keys(culprit).join(',') + ' → ' + culpritStatus);
  return Object.keys(hit);
}

/** 동의 기한이 지난 매칭 정리(교사 화면·매칭·학생 동의 때 실행. 학생 조회 때는 실행하지 않음) */
function expireCheck_() {
  var db = loadFlow_();
  var now = Date.now(), changed = false;
  db.matches.forEach(function (m) {
    if (m.상태 !== MAT.PENDING) return;
    var dl = parseTime_(m.동의기한);
    if (!dl || dl > now) return;
    var ag = agree_(m);
    dissolve_(db, [m.매칭ID], ids_(m).filter(function (id) { return ag[id] !== 'Y'; }), REQ.EXPIRED, '시스템', '동의 기한 만료');
    changed = true;
  });
  if (changed) saveFlow_(db);
  return changed;
}

function runMatching_(actor) {
  expireCheck_();
  var db = loadFlow_();
  var courses = courses_();
  var waiting = db.reqs.filter(function (r) { return r.상태 === REQ.WAIT; });
  var reasons = {};
  var isValid = function (r) {
    var v = revalidate_(db, courses, r);
    if (!v.ok) reasons[r.신청ID] = v.errors[0];
    return v.ok;
  };
  var items = waiting.map(function (r) {
    var o = {}; for (var k in r) o[k] = r[k];
    o.t = parseTime_(r.신청시각) || 0;
    return o;
  });
  var res = computeMatches_(items, isValid);
  var st = settings_();
  var nowS = now_();
  var deadline = fmt_(Date.now() + st.agreeHours * 3600000);
  var rById = index_(db.reqs, '신청ID');
  var counts = { '2인': 0, '3인': 0 };
  var bundleSeen = {};
  res.matches.forEach(function (m) {
    var mid = newId_('M');
    var first = rById[m.reqIds[0]];
    var ag = {};
    m.reqIds.forEach(function (id) {
      ag[id] = '';
      rById[id].상태 = REQ.MATCHED;
      rById[id].매칭ID = mid;
      if (rById[id].연계묶음ID) bundleSeen[rById[id].연계묶음ID] = true;
    });
    db.matches.push({
      매칭ID: mid, 유형: m.type, 학년: first.학년, 학기: first.학기, 선택군: first.선택군,
      신청ID목록: m.reqIds.join(','), 동의현황: JSON.stringify(ag), 매칭시각: nowS,
      동의기한: deadline, 상태: MAT.PENDING, 승인시각: '', 대조확인: '', 메모: ''
    });
    counts[m.type]++;
  });
  saveFlow_(db);
  var invalid = Object.keys(reasons).map(function (id) { return rById[id].학번 + ': ' + reasons[id]; });
  var nb = Object.keys(bundleSeen).length;
  log_(actor, '매칭 실행', '-', '대기 ' + waiting.length + '건', '2인 ' + counts['2인'] + ' / 3인 ' + counts['3인'] + ' / 연계묶음 ' + nb);
  return { pairs: counts['2인'], cycles: counts['3인'], bundles: nb, waiting: waiting.length, invalid: invalid };
}

function autoMatch() {
  if (!ownerOnly_()) return;
  if (!settings_().autoMatch) return;
  withLock_(function () { runMatching_('자동매칭'); });
}

function ownerOnly_() {
  var a = Session.getActiveUser().getEmail(), e = Session.getEffectiveUser().getEmail();
  return !!a && a === e;
}

/* ───────────── 학생 ───────────── */

/** 학생 화면 데이터: 신청·매칭 시트만 읽는다(학생 정보는 접속 정보에서, 과목은 화면에 이미 있음) */
function studentView_(u) {
  var st = settings_();
  var db = loadFlow_();
  var mById = index_(db.matches, '매칭ID');
  var reqs = db.reqs.filter(function (r) { return r.학번 === u.id; })
    .sort(function (x, y) { return x.신청시각 < y.신청시각 ? 1 : -1; })
    .map(function (r) {
      var o = { id: r.신청ID, give: r.내는과목코드, want: r.원하는과목코드, status: r.상태, bundle: r.연계묶음ID, time: r.신청시각, sem: r.학년 + '-' + r.학기 };
      var m = r.매칭ID && mById[r.매칭ID];
      if (m) {
        var ag = agree_(m), ids = ids_(m);
        var dl = parseTime_(m.동의기한);
        o.match = {
          type: m.유형, total: ids.length, agreed: ids.filter(function (id) { return ag[id] === 'Y'; }).length,
          mine: ag[r.신청ID] === 'Y', deadline: m.동의기한, status: m.상태,
          expired: m.상태 === MAT.PENDING && !!dl && dl <= Date.now()
        };
      }
      return o;
    });
  return { me: publicUser_(u), open: isOpen_(st), period: { start: st.start, end: st.end }, reqs: reqs };
}

function stHome(token) {
  var u = auth_(token, ['student']);
  return studentView_(u);
}

function stSubmit(token, swaps, answers) {
  var u = auth_(token, ['student']);
  if (!isOpen_(settings_())) throw new Error('지금은 신청 기간이 아닙니다. 조회만 할 수 있습니다.');
  swaps = (swaps || []).filter(function (s) { return s && s.give && s.want; });
  answers = answers || {};
  var courses = courses_();
  var v = validateDeclared_(courses, swaps, answers, allowedMap_(u.grade));
  if (!v.ok) throw new Error(v.errors.join('\n'));
  var kept = {};
  v.questions.forEach(function (q) { kept[q.code] = answers[q.code]; });
  return withLock_(function () {
    var db = loadFlow_();
    var mine = db.reqs.filter(function (r) { return r.학번 === u.id; });
    swaps.forEach(function (s) {
      var c = courses[s.give];
      if (mine.some(function (r) { return REQ_ACTIVE.indexOf(r.상태) >= 0 && r.학년 === c.학년 && r.학기 === c.학기; })) {
        throw new Error(c.학년 + '학년 ' + c.학기 + '학기에 이미 진행 중인 신청이 있습니다. 기존 신청을 취소한 뒤 다시 신청하세요.');
      }
      if (mine.some(function (r) { return r.상태 === REQ.APPROVED && r.내는과목코드 === s.give; })) {
        throw new Error(lj_(c, '은', '는') + ' 이미 승인된 교환으로 내보낸 과목입니다.');
      }
    });
    var bid = swaps.length > 1 ? newId_('B') : '';
    var nowS = now_();
    var hist = [];
    swaps.forEach(function (s, i) {
      var g = courses[s.give];
      var rid = newId_('R') + i;
      db.reqs.push({
        신청ID: rid, 학번: u.id, 학년: g.학년, 학기: g.학기, 선택군: g.선택군,
        내는과목코드: s.give, 원하는과목코드: s.want, 연계묶음ID: bid, 상태: REQ.WAIT,
        매칭ID: '', 신청시각: nowS, 담임확인: '', 위계응답: JSON.stringify(kept)
      });
      hist.push({ 시각: nowS, 작업자: u.id, 작업: '교환 신청', 대상: rid, '변경 전': label_(g), '변경 후': label_(courses[s.want]) + (bid ? ' (연계 ' + bid + ')' : '') });
    });
    write_('신청', db.reqs);
    append_('이력', hist);
    return studentView_(u);
  });
}

function stCancel(token, reqId) {
  var u = auth_(token, ['student']);
  if (!isOpen_(settings_())) throw new Error('신청 기간이 아니어서 취소할 수 없습니다.');
  return withLock_(function () {
    var reqs = read_('신청');
    var r = reqs.filter(function (x) { return x.신청ID === reqId && x.학번 === u.id; })[0];
    if (!r) throw new Error('신청을 찾을 수 없습니다.');
    var group = r.연계묶음ID ? reqs.filter(function (x) { return x.연계묶음ID === r.연계묶음ID; }) : [r];
    if (group.some(function (x) { return x.상태 !== REQ.WAIT; })) {
      throw new Error('대기 중인 신청만 취소할 수 있습니다. 매칭된 건은 거절 버튼을 사용하세요.');
    }
    group.forEach(function (x) { x.상태 = REQ.CANCELED; });
    write_('신청', reqs);
    log_(u.id, '신청 취소', group.map(function (x) { return x.신청ID; }).join(','), REQ.WAIT, REQ.CANCELED);
    return studentView_(u);
  });
}

function stRespond(token, reqId, accept) {
  var u = auth_(token, ['student']);
  return withLock_(function () {
    expireCheck_();
    var db = loadFlow_();
    var r = db.reqs.filter(function (x) { return x.신청ID === reqId && x.학번 === u.id; })[0];
    if (!r) throw new Error('신청을 찾을 수 없습니다.');
    var group = r.연계묶음ID ? bundleReqs_(db, r.연계묶음ID) : [r];
    var mById = index_(db.matches, '매칭ID');
    group.forEach(function (x) {
      if (x.상태 !== REQ.MATCHED || !mById[x.매칭ID] || mById[x.매칭ID].상태 !== MAT.PENDING) {
        throw new Error('동의를 기다리는 매칭이 아닙니다(기한이 지났을 수 있습니다). 화면을 새로고침하세요.');
      }
    });
    if (!accept) {
      dissolve_(db, [], group.map(function (x) { return x.신청ID; }), REQ.CANCELED, u.id, '학생 거절');
      saveFlow_(db);
      return studentView_(u);
    }
    group.forEach(function (x) {
      var m = mById[x.매칭ID];
      var ag = agree_(m);
      ag[x.신청ID] = 'Y';
      m.동의현황 = JSON.stringify(ag);
      var ids = ids_(m);
      if (ids.every(function (id) { return ag[id] === 'Y'; })) {
        m.상태 = MAT.AGREED;
        db.reqs.forEach(function (q) { if (ids.indexOf(q.신청ID) >= 0) q.상태 = REQ.AGREED; });
      }
    });
    saveFlow_(db);
    log_(u.id, '매칭 동의', group.map(function (x) { return x.신청ID; }).join(','), '', 'Y');
    return studentView_(u);
  });
}

/* ───────────── 담임·관리자 공통 ───────────── */

function canSeeClass_(u, grade, cls) {
  return u.role === '관리자' || (String(u.grade) === String(grade) && String(u.cls) === String(cls));
}

function tcHome(token) {
  var u = auth_(token, ['담임', '관리자']);
  var classes = {};
  if (u.role === '관리자') {
    read_('신청자').forEach(function (s) { classes[s.학년 + '-' + s.반] = { grade: s.학년, cls: s.반 }; });
  } else {
    classes[u.grade + '-' + u.cls] = { grade: u.grade, cls: u.cls };
  }
  return {
    me: { id: u.id, name: u.name, role: u.role, grade: u.grade, cls: u.cls },
    classes: Object.keys(classes).map(function (k) { return classes[k]; })
      .sort(function (a, b) { return (+a.grade - +b.grade) || (+a.cls - +b.cls); }),
    settings: settings_()
  };
}

function answerText_(courses, r) {
  var a = answersOf_(r);
  return Object.keys(a).map(function (k) { return label_(courses[k]) + ' ' + (a[k] === 'Y' ? '수강함' : '수강 안 함'); }).join(', ');
}

function tcClass(token, grade, cls) {
  var u = auth_(token, ['담임', '관리자']);
  if (u.role !== '관리자') { grade = u.grade; cls = u.cls; }
  return withLock_(function () {
    expireCheck_();
    var courses = courses_();
    var people = read_('신청자').filter(function (s) { return s.학년 === String(grade) && s.반 === String(cls); })
      .sort(function (a, b) { return +a.번호 - +b.번호; });
    var sids = {};
    people.forEach(function (s) { sids[s.학번] = true; });
    var db = loadFlow_();
    var mById = index_(db.matches, '매칭ID');
    var reqs = db.reqs.filter(function (r) { return sids[r.학번]; });
    return {
      grade: String(grade), cls: String(cls),
      students: people.map(function (s) {
        return {
          id: s.학번, name: s.이름, no: s.번호, registered: s.등록시각,
          reqs: reqs.filter(function (r) { return r.학번 === s.학번; })
            .sort(function (a, b) { return a.신청시각 < b.신청시각 ? 1 : -1; })
            .map(function (r) {
              var m = r.매칭ID && mById[r.매칭ID];
              var ag = m ? agree_(m) : {};
              return {
                id: r.신청ID, sem: r.학년 + '-' + r.학기, give: label_(courses[r.내는과목코드]),
                want: label_(courses[r.원하는과목코드]), status: r.상태, bundle: r.연계묶음ID,
                time: r.신청시각, confirmed: r.담임확인 === 'Y', answers: answerText_(courses, r),
                match: m ? { type: m.유형, agreed: ids_(m).filter(function (id) { return ag[id] === 'Y'; }).length, total: ids_(m).length } : null
              };
            })
        };
      })
    };
  });
}

function applicant_(sid) {
  return read_('신청자').filter(function (x) { return x.학번 === String(sid); })[0];
}

function tcConfirm(token, reqId, value) {
  var u = auth_(token, ['담임', '관리자']);
  return withLock_(function () {
    var reqs = read_('신청');
    var r = reqs.filter(function (x) { return x.신청ID === reqId; })[0];
    if (!r) throw new Error('신청을 찾을 수 없습니다.');
    var s = applicant_(r.학번);
    if (!s || !canSeeClass_(u, s.학년, s.반)) throw new Error('담당 반 학생만 확인할 수 있습니다.');
    r.담임확인 = value ? 'Y' : '';
    write_('신청', reqs);
    log_(u.id, '담임 대조 확인', reqId, '', value ? 'Y' : '해제');
    return true;
  });
}

function tcResetPin(token, sid) {
  var u = auth_(token, ['담임', '관리자']);
  return withLock_(function () {
    var rows = read_('신청자');
    var s = rows.filter(function (x) { return x.학번 === String(sid); })[0];
    if (!s) throw new Error('신청자를 찾을 수 없습니다.');
    if (!canSeeClass_(u, s.학년, s.반)) throw new Error('담당 반 학생만 재설정할 수 있습니다.');
    var pin;
    do { pin = randomPin_(); } while (/^(\d)\1{3}$/.test(pin) || pin === '1234');
    s.솔트 = Utilities.getUuid();
    s.비밀번호해시 = hash_(pin, s.솔트);
    write_('신청자', rows);
    setValidSalt_(s.학번, s.솔트);
    log_(u.id, '학생 비밀번호 재설정', s.학번, '', '');
    return { id: s.학번, name: s.이름, pin: pin };
  });
}

function tcRemoveApplicant(token, sid) {
  var u = auth_(token, ['담임', '관리자']);
  return withLock_(function () {
    var rows = read_('신청자');
    var s = rows.filter(function (x) { return x.학번 === String(sid); })[0];
    if (!s) throw new Error('신청자를 찾을 수 없습니다.');
    if (!canSeeClass_(u, s.학년, s.반)) throw new Error('담당 반 학생만 삭제할 수 있습니다.');
    var db = loadFlow_();
    var mine = db.reqs.filter(function (r) { return r.학번 === s.학번; });
    if (mine.some(function (r) { return r.상태 === REQ.APPROVED; })) throw new Error('이미 승인된 교환이 있는 학생은 삭제할 수 없습니다. 관리자에게 문의하세요.');
    var live = mine.filter(function (r) { return REQ_ACTIVE.indexOf(r.상태) >= 0; }).map(function (r) { return r.신청ID; });
    if (live.length) dissolve_(db, [], live, REQ.REJECTED, u.id, '등록 삭제');
    db.reqs = db.reqs.filter(function (r) { return r.학번 !== s.학번; });
    saveFlow_(db);
    write_('신청자', rows.filter(function (x) { return x.학번 !== s.학번; }));
    setValidSalt_(s.학번, 'deleted');
    log_(u.id, '신청자 등록 삭제', s.학번, s.이름, '');
    return true;
  });
}

function tcChangePw(token, oldPw, newPw) {
  var u = auth_(token, ['담임', '관리자']);
  if (!newPw || String(newPw).length < 8) throw new Error('새 비밀번호는 8자 이상이어야 합니다.');
  return withLock_(function () {
    var ts = read_('교사');
    var t = ts.filter(function (x) { return x.교사ID === u.id; })[0];
    if (!t || hash_(String(oldPw), t.솔트) !== t.비밀번호해시) throw new Error('현재 비밀번호가 맞지 않습니다.');
    t.솔트 = Utilities.getUuid();
    t.비밀번호해시 = hash_(String(newPw), t.솔트);
    write_('교사', ts);
    log_(u.id, '비밀번호 변경', u.id, '', '');
    return true;
  });
}

/* ───────────── 관리자 ───────────── */

function adDashboard(token) {
  auth_(token, ['관리자']);
  return withLock_(function () {
    expireCheck_();
    var courses = courses_();
    var db = loadFlow_();
    var groups = {};
    Object.keys(courses).forEach(function (k) {
      var c = courses[k];
      var gk = c.학년 + '-' + c.학기 + '|' + c.선택군;
      groups[gk] = groups[gk] || { key: c.학년 + '-' + c.학기, group: c.선택군, total: 0, wait: 0, matching: 0, approved: 0, courses: {} };
      groups[gk].courses[k] = { label: label_(c), give: 0, want: 0 };
    });
    var bundles = {};
    db.reqs.forEach(function (r) {
      if (r.연계묶음ID && (REQ_ACTIVE.indexOf(r.상태) >= 0 || r.상태 === REQ.APPROVED)) bundles[r.연계묶음ID] = true;
      var c = courses[r.내는과목코드]; if (!c) return;
      var g = groups[c.학년 + '-' + c.학기 + '|' + c.선택군]; if (!g) return;
      if (REQ_ACTIVE.indexOf(r.상태) >= 0 || r.상태 === REQ.APPROVED) g.total++;
      if (r.상태 === REQ.WAIT) {
        g.wait++;
        g.courses[r.내는과목코드].give++;
        if (g.courses[r.원하는과목코드]) g.courses[r.원하는과목코드].want++;
      }
      if (r.상태 === REQ.MATCHED || r.상태 === REQ.AGREED) g.matching++;
      if (r.상태 === REQ.APPROVED) g.approved++;
    });
    var status = {};
    db.reqs.forEach(function (r) { status[r.상태] = (status[r.상태] || 0) + 1; });
    var mt = { '2인': 0, '3인': 0 };
    db.matches.forEach(function (m) { if (m.상태 !== MAT.DISSOLVED && m.상태 !== MAT.REJECTED) mt[m.유형] = (mt[m.유형] || 0) + 1; });
    var st = settings_();
    return {
      settings: st, open: isOpen_(st), applicants: read_('신청자').length,
      reqStatus: status, matchTypes: mt, bundles: Object.keys(bundles).length,
      groups: Object.keys(groups).sort().map(function (k) {
        var g = groups[k];
        g.courses = Object.keys(g.courses).sort().map(function (c) { return g.courses[c]; })
          .filter(function (c) { return c.give || c.want; });
        return g;
      })
    };
  });
}

function adRunMatching(token) {
  var u = auth_(token, ['관리자']);
  return withLock_(function () { return runMatching_(u.id); });
}

function adMatches(token, statusFilter) {
  auth_(token, ['관리자']);
  return withLock_(function () {
    expireCheck_();
    var courses = courses_();
    var db = loadFlow_();
    var rById = index_(db.reqs, '신청ID');
    var sById = index_(read_('신청자'), '학번');
    return db.matches
      .filter(function (m) { return !statusFilter || m.상태 === statusFilter; })
      .sort(function (a, b) { return a.매칭시각 < b.매칭시각 ? 1 : -1; })
      .map(function (m) {
        var ag = agree_(m);
        return {
          id: m.매칭ID, type: m.유형, sem: m.학년 + '-' + m.학기, group: m.선택군, status: m.상태,
          time: m.매칭시각, deadline: m.동의기한, approvedAt: m.승인시각, verifiedBy: m.대조확인, memo: m.메모,
          members: ids_(m).map(function (rid) {
            var r = rById[rid] || {};
            var s = sById[r.학번] || {};
            return {
              reqId: rid, sid: r.학번, name: s.이름 || '(삭제됨)', cls: s.학년 ? s.학년 + '-' + s.반 + '-' + s.번호 : '',
              give: label_(courses[r.내는과목코드]), want: label_(courses[r.원하는과목코드]),
              agreed: ag[rid] === 'Y', bundle: r.연계묶음ID, confirmed: r.담임확인 === 'Y',
              answers: answerText_(courses, r)
            };
          })
        };
      });
  });
}

function components_(db, startIds) {
  var mById = index_(db.matches, '매칭ID'), rById = index_(db.reqs, '신청ID');
  var seen = {}, out = [];
  startIds.forEach(function (s) {
    if (seen[s] || !mById[s]) return;
    var comp = [], q = [s];
    while (q.length) {
      var mid = q.pop();
      if (seen[mid] || !mById[mid]) continue;
      seen[mid] = true; comp.push(mid);
      ids_(mById[mid]).forEach(function (rid) {
        var r = rById[rid];
        if (r && r.연계묶음ID) bundleReqs_(db, r.연계묶음ID).forEach(function (x) { if (x.매칭ID) q.push(x.매칭ID); });
      });
    }
    out.push(comp);
  });
  return out;
}

/** 승인: 학교 수강 기록과 대조했다는 확인(verified)이 있어야 한다 */
function adApprove(token, matchIds, verified) {
  var u = auth_(token, ['관리자']);
  if (verified !== true) throw new Error('승인하려면 "학교 수강 기록과 대조했습니다"에 체크해야 합니다.');
  return withLock_(function () {
    expireCheck_();
    var courses = courses_();
    var db = loadFlow_();
    var mById = index_(db.matches, '매칭ID'), rById = index_(db.reqs, '신청ID');
    var res = { approved: 0, held: [], skipped: [] };
    var nowS = now_();
    components_(db, matchIds || []).forEach(function (comp) {
      if (comp.some(function (mid) { return mById[mid].상태 !== MAT.AGREED; })) {
        res.skipped.push(comp.join('+') + ': 모든 학생의 동의가 끝나지 않았습니다(연계 묶음 포함).');
        return;
      }
      var problems = [], seenBundle = {};
      comp.forEach(function (mid) {
        ids_(mById[mid]).forEach(function (rid) {
          var r = rById[rid];
          var key = r.연계묶음ID || r.신청ID;
          if (seenBundle[key]) return;
          seenBundle[key] = true;
          var v = revalidate_(db, courses, r);
          if (!v.ok) problems.push(r.학번 + ': ' + v.errors.join(' / '));
        });
      });
      if (problems.length) {
        comp.forEach(function (mid) { mById[mid].상태 = MAT.HOLD; mById[mid].메모 = problems.join(' | '); });
        res.held.push(comp.join('+') + ' → ' + problems.join(' | '));
        log_(u.id, '승인 보류', comp.join(','), '', problems.join(' | '));
        return;
      }
      comp.forEach(function (mid) {
        var m = mById[mid];
        m.상태 = MAT.APPROVED; m.승인시각 = nowS; m.대조확인 = u.id;
        ids_(m).forEach(function (rid) {
          var r = rById[rid];
          r.상태 = REQ.APPROVED;
          log_(u.id, '교환 승인', r.학번, r.내는과목코드 + ' ' + label_(courses[r.내는과목코드]), r.원하는과목코드 + ' ' + label_(courses[r.원하는과목코드]));
        });
      });
      res.approved += comp.length;
    });
    saveFlow_(db);
    return res;
  });
}

function adReject(token, matchIds, memo) {
  var u = auth_(token, ['관리자']);
  return withLock_(function () {
    var db = loadFlow_();
    var mById = index_(db.matches, '매칭ID');
    var culprits = [];
    (matchIds || []).forEach(function (mid) {
      var m = mById[mid];
      if (m && MAT_LIVE.indexOf(m.상태) >= 0) culprits = culprits.concat(ids_(m));
    });
    if (!culprits.length) throw new Error('반려할 수 있는 매칭이 없습니다.');
    var hit = dissolve_(db, matchIds, culprits, REQ.REJECTED, u.id, memo || '관리자 반려');
    saveFlow_(db);
    return { rejected: hit.length };
  });
}

function adSaveSettings(token, s) {
  var u = auth_(token, ['관리자']);
  return withLock_(function () {
    var clean = function (v) { return String(v || '').replace('T', ' ').trim(); };
    if (s.start && !parseTime_(clean(s.start))) throw new Error('신청 시작 일시 형식이 올바르지 않습니다.');
    if (s.end && !parseTime_(clean(s.end))) throw new Error('신청 마감 일시 형식이 올바르지 않습니다.');
    var hours = Number(s.agreeHours);
    if (!(hours > 0)) throw new Error('동의 기한은 0보다 커야 합니다.');
    var autoHours = [1, 2, 4, 6, 8, 12].indexOf(Number(s.autoHours)) >= 0 ? Number(s.autoHours) : 1;
    var rows = read_('설정');
    var put = function (k, v) {
      var r = rows.filter(function (x) { return x.키 === k; })[0];
      if (r) r.값 = v; else rows.push({ 키: k, 값: v, 설명: '' });
    };
    put('신청시작', clean(s.start));
    put('신청마감', clean(s.end));
    put('동의기한(시간)', String(hours));
    put('자동매칭', s.autoMatch ? 'ON' : 'OFF');
    put('자동매칭간격(시간)', String(autoHours));
    put('웹앱주소', String(s.webUrl || '').trim());
    var classes = Number(s.classes), maxNo = Number(s.maxNo);
    if (!(classes >= 1 && classes <= 30)) throw new Error('반 수는 1~30 사이로 정하세요.');
    if (!(maxNo >= 1 && maxNo <= 60)) throw new Error('반별 최대 번호는 1~60 사이로 정하세요.');
    put('반 수', String(classes));
    put('반별 최대 번호', String(maxNo));
    put('개인정보안내', String(s.notice || '').trim() || DEFAULT_NOTICE);
    write_('설정', rows);
    clearCache_();
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'autoMatch') ScriptApp.deleteTrigger(t);
    });
    if (s.autoMatch) ScriptApp.newTrigger('autoMatch').timeBased().everyHours(autoHours).create();
    log_(u.id, '설정 변경', '설정', '', '기간 ' + clean(s.start) + '~' + clean(s.end));
    return settings_();
  });
}

/** CSV 업로드: 과목 | 교사 */
function adUpload(token, kind, csvText) {
  var u = auth_(token, ['관리자']);
  return withLock_(function () {
    var rows = Utilities.parseCsv(String(csvText || '').replace(/^﻿/, ''));
    rows = rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
    if (rows.length < 2) throw new Error('CSV에 데이터가 없습니다. 첫 줄은 머리글이어야 합니다.');
    var head = rows[0].map(function (h) { return String(h).trim(); });
    var need = { '과목': ['과목코드', '학년', '학기', '선택군', '과목명', '학점'], '교사': ['교사ID', '이름', '역할', '담당학년', '담당반'] }[kind];
    if (!need) throw new Error('알 수 없는 업로드 종류입니다.');
    var missing = need.filter(function (h) { return head.indexOf(h) < 0; });
    if (missing.length) throw new Error('머리글이 빠졌습니다: ' + missing.join(', '));
    var data = rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = String(r[i] === undefined ? '' : r[i]).trim(); });
      return o;
    });
    var errors = [];
    if (kind === '과목') {
      if (read_('신청').some(function (r) { return REQ_ACTIVE.indexOf(r.상태) >= 0; })) {
        throw new Error('진행 중인 신청이 있어 과목 데이터를 덮어쓸 수 없습니다. 신청이 모두 끝난 뒤 업로드하세요.');
      }
      var codes = {}, names = {};
      data.forEach(function (c, i) {
        var line = (i + 2) + '행';
        if (codes[c.과목코드]) errors.push(line + ': 과목코드 중복 ' + c.과목코드);
        codes[c.과목코드] = c;
        var nk = c.학년 + '|' + c.학기 + '|' + c.과목명;
        if (names[nk]) errors.push(line + ': 같은 학년·학기에 같은 과목명 중복 (' + c.과목명 + ')');
        names[nk] = true;
        if (!/^[1-3]$/.test(c.학년) || !/^[12]$/.test(c.학기)) errors.push(line + ': 학년/학기 값 오류');
        c.표시명 = label_(c);
        c.선수과목코드 = c.선수과목코드 || '';
      });
      data.forEach(function (c, i) {
        if (!c.선수과목코드) return;
        var p = codes[c.선수과목코드];
        if (!p) errors.push((i + 2) + '행: 선수과목코드 ' + c.선수과목코드 + '가 과목 목록에 없습니다.');
        else if ((+p.학년 * 10 + +p.학기) >= (+c.학년 * 10 + +c.학기)) errors.push((i + 2) + '행: 선수과목은 이전 학기 과목이어야 합니다.');
      });
    } else {
      var oldT = index_(read_('교사'), '교사ID'), seenT = {};
      data.forEach(function (t, i) {
        var line = (i + 2) + '행';
        if (seenT[t.교사ID]) errors.push(line + ': 교사ID 중복');
        seenT[t.교사ID] = true;
        if (t.역할 !== '담임' && t.역할 !== '관리자') errors.push(line + ': 역할은 담임 또는 관리자여야 합니다.');
        if (t.초기비밀번호) { t.솔트 = Utilities.getUuid(); t.비밀번호해시 = hash_(t.초기비밀번호, t.솔트); }
        else if (oldT[t.교사ID]) { t.솔트 = oldT[t.교사ID].솔트; t.비밀번호해시 = oldT[t.교사ID].비밀번호해시; }
        else errors.push(line + ': 새 교사는 초기비밀번호가 필요합니다.');
        delete t.초기비밀번호;
      });
      if (!data.some(function (t) { return t.역할 === '관리자'; })) errors.push('관리자가 최소 1명 있어야 합니다.');
      if (!seenT[u.id]) errors.push('지금 로그인한 관리자(' + u.id + ')가 목록에 없습니다.');
    }
    if (errors.length) throw new Error('업로드하지 않았습니다.\n' + errors.slice(0, 15).join('\n') + (errors.length > 15 ? '\n… 외 ' + (errors.length - 15) + '건' : ''));
    write_(kind, data);
    clearCache_();
    log_(u.id, kind + ' 업로드', kind, '', data.length + '행');
    return { count: data.length };
  });
}

function exportRows_() {
  var courses = courses_();
  var db = loadFlow_();
  var sById = index_(read_('신청자'), '학번');
  var head = ['학번', '이름', '학년', '반', '번호', '교환 학기', '선택군', '변경 전 과목코드', '변경 전 과목명',
    '변경 후 과목코드', '변경 후 과목명', '교환유형', '연계묶음ID', '위계 응답', '대조 확인', '승인일시'];
  var approvedMatch = {};
  db.matches.forEach(function (m) { if (m.상태 === MAT.APPROVED) ids_(m).forEach(function (id) { approvedMatch[id] = m; }); });
  var rows = db.reqs.filter(function (r) { return r.상태 === REQ.APPROVED; }).map(function (r) {
    var s = sById[r.학번] || {}, m = approvedMatch[r.신청ID] || {};
    return [r.학번, s.이름 || '', s.학년 || '', s.반 || '', s.번호 || '', r.학년 + '-' + r.학기, r.선택군,
      r.내는과목코드, label_(courses[r.내는과목코드]), r.원하는과목코드, label_(courses[r.원하는과목코드]),
      m.유형 || '', r.연계묶음ID, answerText_(courses, r), m.대조확인 || '', m.승인시각 || ''];
  }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[5] < b[5] ? -1 : 1); });
  return [head].concat(rows);
}

function adExport(token) {
  var u = auth_(token, ['관리자']);
  var data = exportRows_();
  var name = '선택과목_교환결과_' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmm');
  var file = SpreadsheetApp.create(name);
  var sh = file.getSheets()[0];
  sh.setName('교환결과');
  var rng = sh.getRange(1, 1, data.length, data[0].length);
  rng.setNumberFormat('@');
  rng.setValues(data);
  sh.setFrozenRows(1);
  log_(u.id, '결과 내보내기', name, '', (data.length - 1) + '건');
  return { name: name, url: file.getUrl(), xlsx: 'https://docs.google.com/spreadsheets/d/' + file.getId() + '/export?format=xlsx', count: data.length - 1, csv: data };
}

function adHistory(token, n) {
  auth_(token, ['관리자']);
  var rows = read_('이력');
  return rows.slice(-Math.min(Number(n) || 200, 1000)).reverse();
}

/** 교환 기간이 끝난 뒤 학생 개인정보를 모두 지운다('삭제' 입력 필요) */
function adPurge(token, confirmText) {
  var u = auth_(token, ['관리자']);
  if (String(confirmText || '').trim() !== '삭제') throw new Error('확인을 위해 "삭제"를 입력하세요.');
  return withLock_(function () {
    var n = read_('신청자').length, m = read_('신청').length;
    ['신청자', '신청', '매칭', '이력'].forEach(function (s) { write_(s, []); });
    CacheService.getScriptCache().put('X_ALL', String(Date.now()), 21600);
    log_(u.id, '학생 개인정보 일괄 삭제', '-', '신청자 ' + n + '명 / 신청 ' + m + '건', '모두 삭제');
    return { applicants: n, requests: m };
  });
}
