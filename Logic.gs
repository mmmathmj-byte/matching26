/**
 * Logic.gs — 시트와 무관한 순수 로직 (검증·위계·매칭)
 * 모든 판단은 과목명이 아니라 과목코드로 한다.
 */

var REQ = {
  WAIT: '대기', MATCHED: '매칭됨', AGREED: '동의완료', APPROVED: '승인',
  REJECTED: '반려', CANCELED: '취소', EXPIRED: '기한만료'
};
var REQ_ACTIVE = ['대기', '매칭됨', '연계대기', '동의완료'];
var MAT = {
  PENDING: '동의대기', AGREED: '동의완료', APPROVED: '승인',
  HOLD: '보류', DISSOLVED: '해제', REJECTED: '반려'
};
var MAT_LIVE = ['동의대기', '동의완료', '보류'];

function semKey_(c) { return c.학년 + '-' + c.학기; }
function label_(c) { return c ? '[' + c.학년 + '-' + c.학기 + '] ' + c.과목명 : '(알 수 없는 과목)'; }

/** 받침 유무에 따라 조사 선택: josa_('물리학','을','를') */
function josa_(word, withBatchim, withoutBatchim) {
  var s = String(word).replace(/[\s\)\]]+$/, '');
  var ch = s.charCodeAt(s.length - 1);
  if (ch >= 0xAC00 && ch <= 0xD7A3) {
    return ((ch - 0xAC00) % 28) ? withBatchim : withoutBatchim;
  }
  return withBatchim + '(' + withoutBatchim + ')';
}
function lj_(c, a, b) { return label_(c) + josa_(c ? c.과목명 : '', a, b); }

/** 수강 목록에 교환을 적용한 과목코드 집합 */
function afterSet_(enroll, swaps) {
  var set = {};
  enroll.forEach(function (e) { set[e.과목코드] = true; });
  (swaps || []).forEach(function (s) { delete set[s.give]; set[s.want] = true; });
  return set;
}

function prereqProblems_(set, courses) {
  var out = [];
  Object.keys(set).forEach(function (code) {
    var c = courses[code];
    if (c && c.선수과목코드 && !set[c.선수과목코드]) out.push({ course: code, prereq: c.선수과목코드 });
  });
  return out;
}

/**
 * 교환으로 새로 생기는 위계 위반만 학생용 문장으로 반환.
 * allowed(선택): { '2-1': true, ... } 지금 바꿀 수 있는 학기. 함께 바꿔야 할 과목이 그 밖이면 연계 신청 대신 불가 안내.
 */
function hierarchyViolations_(enroll, courses, swaps, allowed) {
  var before = {};
  prereqProblems_(afterSet_(enroll, []), courses).forEach(function (p) { before[p.course + '|' + p.prereq] = true; });
  var fixable = function (c) { return !allowed || !!allowed[semKey_(c)]; };
  return prereqProblems_(afterSet_(enroll, swaps), courses)
    .filter(function (p) { return !before[p.course + '|' + p.prereq]; })
    .map(function (p) {
      var c = courses[p.course], pr = courses[p.prereq];
      var givesPrereq = swaps.some(function (s) { return s.give === p.prereq; });
      if (givesPrereq) {
        return lj_(pr, '을', '를') + ' 내면 ' + label_(c) + '의 선수과목이 없어집니다. ' +
          (fixable(c) ? lj_(c, '도', '도') + ' 연계 신청으로 함께 바꾸면 가능합니다.'
            : lj_(c, '은', '는') + ' 지금 바꿀 수 있는 학기의 과목이 아니어서 이 교환은 할 수 없습니다.');
      }
      return lj_(c, '을', '를') + ' 들으려면 선수과목 ' + lj_(pr, '이', '가') + ' 필요합니다. ' +
        (fixable(pr) ? '연계 신청으로 선수과목도 함께 바꾸면 가능합니다.'
          : lj_(pr, '은', '는') + ' 지금 바꿀 수 있는 학기의 과목이 아니어서 이 교환은 할 수 없습니다.');
    });
}

/**
 * 교환 묶음 검증.
 * enroll: [{과목코드, 이수상태}] (한 학생), courses: {코드: 과목}, swaps: [{give, want}]
 */
function validateSwaps_(enroll, courses, swaps, allowed) {
  var errors = [];
  if (!swaps || !swaps.length) return { ok: false, errors: ['교환할 과목을 선택하세요.'] };
  if (swaps.length > 3) errors.push('연계 신청은 최대 3건까지 묶을 수 있습니다.');
  var have = {};
  enroll.forEach(function (e) { have[e.과목코드] = e.이수상태 || '예정'; });
  var semSeen = {};
  swaps.forEach(function (s) {
    var g = courses[s.give], w = courses[s.want];
    if (!g || !w) { errors.push('존재하지 않는 과목코드가 포함되어 있습니다.'); return; }
    if (s.give === s.want) { errors.push(label_(g) + ': 같은 과목으로는 교환할 수 없습니다.'); return; }
    if (String(g.학년) !== String(w.학년) || String(g.학기) !== String(w.학기)) {
      errors.push(label_(g) + ' → ' + label_(w) + ': 학년·학기가 다른 과목끼리는 교환할 수 없습니다. ' +
        '과목명이 같아도 학기가 다르면 다른 과목입니다.');
    } else if (g.선택군 !== w.선택군) {
      errors.push(label_(g) + '(' + g.선택군 + ') → ' + label_(w) + '(' + w.선택군 + '): ' +
        '선택군이 달라 시간표가 겹치므로 교환할 수 없습니다.');
    }
    if (String(g.학점) !== String(w.학점)) errors.push(label_(g) + ' → ' + label_(w) + ': 학점이 달라 교환할 수 없습니다.');
    if (!(s.give in have)) errors.push(lj_(g, '은', '는') + ' 내가 수강하는 과목이 아닙니다.');
    else if (have[s.give] === '이수') errors.push(lj_(g, '은', '는') + ' 이미 이수한 과목이라 교환할 수 없습니다.');
    if (s.want in have) errors.push(lj_(w, '은', '는') + ' 이미 수강하는 과목입니다.');
    var k = semKey_(g);
    if (semSeen[k]) errors.push(g.학년 + '학년 ' + g.학기 + '학기 신청이 2건 이상입니다. 한 학기에는 1건만 신청할 수 있습니다.');
    semSeen[k] = true;
  });
  if (errors.length) return { ok: false, errors: errors };
  var hv = hierarchyViolations_(enroll, courses, swaps, allowed);
  if (hv.length) return { ok: false, errors: hv, hierarchy: true };
  return { ok: true, errors: [] };
}

/**
 * 내는 과목에 대해 같은 선택군의 후보와 가능 여부.
 * softHierarchy=true(연계 신청 작성 중)면 위계 문제는 막지 않고 경고(warn)로만 알려준다.
 * 다른 학기 행을 채우면 풀릴 수 있기 때문이며, 최종 제출 때는 묶음 전체로 다시 검사한다.
 */
function candidateOptions_(enroll, courses, give, otherSwaps, softHierarchy) {
  var g = courses[give];
  if (!g) return [];
  return Object.keys(courses).map(function (k) { return courses[k]; })
    .filter(function (c) {
      return c.과목코드 !== give && String(c.학년) === String(g.학년) &&
        String(c.학기) === String(g.학기) && c.선택군 === g.선택군;
    })
    .sort(function (a, b) { return a.과목코드 < b.과목코드 ? -1 : 1; })
    .map(function (c) {
      var v = validateSwaps_(enroll, courses, (otherSwaps || []).concat([{ give: give, want: c.과목코드 }]));
      if (!v.ok && v.hierarchy && softHierarchy) {
        return { code: c.과목코드, label: label_(c), group: c.선택군, ok: true, warn: v.errors[0], reason: '' };
      }
      return { code: c.과목코드, label: label_(c), group: c.선택군, ok: v.ok, warn: '', reason: v.ok ? '' : v.errors[0] };
    });
}

function byTime_(a, b) {
  if (a.t !== b.t) return a.t - b.t;
  return a.신청ID < b.신청ID ? -1 : 1;
}

/** 학년·학기·선택군 버킷별 2인 → 3인 매칭 */
function matchPool_(pool) {
  var buckets = {};
  pool.forEach(function (r) {
    var k = r.학년 + '|' + r.학기 + '|' + r.선택군;
    (buckets[k] = buckets[k] || []).push(r);
  });
  var out = [];
  Object.keys(buckets).sort().forEach(function (k) {
    var list = buckets[k].slice().sort(byTime_);
    var used = {};
    // 1단계: 2인 맞교환
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (used[a.신청ID]) continue;
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j];
        if (used[b.신청ID] || b.학번 === a.학번) continue;
        if (b.내는과목코드 === a.원하는과목코드 && b.원하는과목코드 === a.내는과목코드) {
          used[a.신청ID] = used[b.신청ID] = true;
          out.push({ type: '2인', reqIds: [a.신청ID, b.신청ID] });
          break;
        }
      }
    }
    // 2단계: 3인 순환 A:X→Y, B:Y→Z, C:Z→X
    for (var x = 0; x < list.length; x++) {
      var A = list[x];
      if (used[A.신청ID]) continue;
      var found = null;
      for (var y = 0; y < list.length && !found; y++) {
        var B = list[y];
        if (y === x || used[B.신청ID] || B.학번 === A.학번 || B.내는과목코드 !== A.원하는과목코드) continue;
        for (var z = 0; z < list.length; z++) {
          var C = list[z];
          if (z === x || z === y || used[C.신청ID] || C.학번 === A.학번 || C.학번 === B.학번) continue;
          if (C.내는과목코드 === B.원하는과목코드 && C.원하는과목코드 === A.내는과목코드) { found = [A, B, C]; break; }
        }
      }
      if (found) {
        found.forEach(function (r) { used[r.신청ID] = true; });
        out.push({ type: '3인', reqIds: found.map(function (r) { return r.신청ID; }) });
      }
    }
  });
  return out;
}

/**
 * 매칭 계산. reqs: '대기' 신청(+ t: 신청시각 ms), isValid(r): 현재 수강 기준 재검증
 * 연계 묶음은 모든 신청이 동시에 매칭될 때만 매칭을 만든다(다른 학생이 묶여 기다리지 않게).
 */
function computeMatches_(reqs, isValid) {
  var excluded = {};
  var bundles = {};
  reqs.forEach(function (r) { if (r.연계묶음ID) (bundles[r.연계묶음ID] = bundles[r.연계묶음ID] || []).push(r); });
  reqs.forEach(function (r) {
    if (isValid && !isValid(r)) {
      excluded[r.신청ID] = true;
      if (r.연계묶음ID) bundles[r.연계묶음ID].forEach(function (x) { excluded[x.신청ID] = true; });
    }
  });
  for (var guard = 0; guard < 1000; guard++) {
    var pool = reqs.filter(function (r) { return !excluded[r.신청ID]; });
    var matches = matchPool_(pool);
    var matched = {};
    matches.forEach(function (m) { m.reqIds.forEach(function (id) { matched[id] = true; }); });
    var bad = Object.keys(bundles).filter(function (b) {
      return bundles[b].some(function (r) { return !excluded[r.신청ID]; }) &&
        bundles[b].some(function (r) { return !matched[r.신청ID]; });
    });
    if (!bad.length) return { matches: matches, excluded: excluded };
    bad.forEach(function (b) { bundles[b].forEach(function (r) { excluded[r.신청ID] = true; }); });
  }
  return { matches: [], excluded: excluded };
}

/* ───────────── 자기 신고 방식(수강 명단 없이 운영) ───────────── */

/** 과목코드 → 그 과목을 선수과목으로 둔 과목들 */
function dependentsMap_(courses) {
  var dep = {};
  Object.keys(courses).forEach(function (k) {
    var p = courses[k].선수과목코드;
    if (p) (dep[p] = dep[p] || []).push(k);
  });
  return dep;
}

/**
 * 위계 확인 질문. 학교 수강 명단이 없으므로 위계에 걸리는 과목만 학생에게 묻는다.
 * - 내는 과목을 선수과목으로 둔 뒤 학기 과목을 듣는지(follow)
 * - 원하는 과목의 선수과목을 들었거나 들을 예정인지(prereq)
 * 묶음 안에서 이미 내거나 받는 과목은 묻지 않는다.
 */
function hierarchyQuestions_(courses, swaps) {
  var gives = {}, wants = {}, seen = {}, qs = [];
  swaps.forEach(function (s) { gives[s.give] = true; wants[s.want] = true; });
  var dep = dependentsMap_(courses);
  swaps.forEach(function (s) {
    if (!courses[s.give] || !courses[s.want]) return;
    (dep[s.give] || []).forEach(function (d) {
      if (gives[d] || wants[d] || seen[d]) return;
      seen[d] = true;
      qs.push({ code: d, kind: 'follow', about: s.give,
        text: lj_(courses[d], '을', '를') + ' 수강하나요? (수강 예정 포함)' });
    });
    var p = courses[s.want].선수과목코드;
    if (p && !wants[p] && !gives[p] && !seen[p]) {
      seen[p] = true;
      qs.push({ code: p, kind: 'prereq', about: s.want,
        text: label_(courses[s.want]) + '의 선수과목 ' + lj_(courses[p], '을', '를') + ' 수강했거나 수강 예정인가요?' });
    }
  });
  return qs;
}

/** 학생이 신고한 내용으로 만든 수강 상태: 내는 과목 + '예'라고 답한 과목 */
function declaredEnroll_(swaps, answers) {
  var e = {};
  (swaps || []).forEach(function (s) { e[s.give] = '예정'; });
  Object.keys(answers || {}).forEach(function (k) { if (answers[k] === 'Y' && !(k in e)) e[k] = '예정'; });
  return Object.keys(e).map(function (k) { return { 과목코드: k, 이수상태: e[k] }; });
}

/**
 * 신고 기반 검증. answers: { 과목코드: 'Y'|'N' }, allowed(선택): 지금 바꿀 수 있는 학기
 * 반환: { ok, errors, questions, unanswered }
 */
function validateDeclared_(courses, swaps, answers, allowed) {
  answers = answers || {};
  swaps = swaps || [];
  var semErr = [];
  if (allowed) {
    swaps.forEach(function (s) {
      var g = courses[s.give];
      if (g && !allowed[semKey_(g)]) semErr.push(lj_(g, '은', '는') + ' 지금 바꿀 수 있는 학기의 과목이 아닙니다. (1학년은 2학년 과목, 2학년은 3학년 과목만 바꿀 수 있습니다)');
    });
  }
  var qs = hierarchyQuestions_(courses, swaps);
  var unanswered = qs.filter(function (q) { return answers[q.code] !== 'Y' && answers[q.code] !== 'N'; });
  var used = {};
  qs.forEach(function (q) { used[q.code] = answers[q.code]; });
  var v = validateSwaps_(declaredEnroll_(swaps, used), courses, swaps, allowed);
  var errors = semErr.concat(v.errors);
  if (unanswered.length && !errors.length) errors.push('아래 질문에 모두 답해 주세요.');
  return { ok: !errors.length, errors: errors, questions: qs, unanswered: unanswered.length, hierarchy: !!v.hierarchy };
}

/* ───────────── 학년별 교환 가능 학기 ───────────── */

/** 1학년은 2학년 과목, 2학년은 3학년 과목만 바꿀 수 있다 */
function allowedSems_(grade) {
  grade = String(grade);
  if (grade === '1') return ['2-1', '2-2'];
  if (grade === '2') return ['3-1', '3-2'];
  return [];
}
function allowedMap_(grade) {
  var m = {};
  allowedSems_(grade).forEach(function (k) { m[k] = true; });
  return m;
}

/**
 * 화면(브라우저)에서도 같은 검증을 바로 돌리기 위해 함수 소스를 그대로 넘긴다.
 * 과목을 고를 때마다 서버에 묻지 않아도 되므로 화면이 빨라진다. 제출할 때는 서버가 다시 검증한다.
 */
function clientLogic_() {
  return [semKey_, label_, josa_, lj_, afterSet_, prereqProblems_, hierarchyViolations_, validateSwaps_,
    dependentsMap_, hierarchyQuestions_, declaredEnroll_, validateDeclared_, allowedSems_, allowedMap_]
    .map(function (f) { return f.toString(); }).join('\n');
}
