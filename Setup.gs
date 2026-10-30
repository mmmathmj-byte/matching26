/**
 * Setup.gs — 처음 한 번 실행하는 초기화 함수 (학생 직접 입력 방식)
 * 편집기에서 setup 을 선택하고 ▶실행. (웹앱으로는 호출되지 않도록 막혀 있음)
 */

var COURSE_SEED = [
  'G2S1-01,2,1,2-1-A,현대사회와 윤리,3,', 'G2S1-02,2,1,2-1-A,세계 시민과 지리,3,',
  'G2S1-03,2,1,2-1-A,사회와 문화,3,', 'G2S1-04,2,1,2-1-A,세계사,3,', 'G2S1-05,2,1,2-1-A,물리학,3,',
  'G2S1-06,2,1,2-1-A,화학,3,', 'G2S1-07,2,1,2-1-A,생명과학,3,', 'G2S1-08,2,1,2-1-A,지구과학,3,',
  'G2S1-09,2,1,2-1-B,기술·가정,3,', 'G2S1-10,2,1,2-1-B,정보,3,', 'G2S1-11,2,1,2-1-B,한문,3,',
  'G2S1-12,2,1,2-1-B,중국어,3,', 'G2S1-13,2,1,2-1-B,일본어,3,', 'G2S1-14,2,1,2-1-B,문학과 영상,3,',
  'G2S1-15,2,1,2-1-B,기하,3,', 'G2S1-16,2,1,2-1-B,세계 문화와 영어,3,', 'G2S1-17,2,1,2-1-B,미술과 매체,3,',
  'G2S1-18,2,1,2-1-B,음악감상과 비평(1학기),3,',
  'G2S2-01,2,2,2-2-A,윤리와 사상,3,', 'G2S2-02,2,2,2-2-A,한국지리 탐구,3,', 'G2S2-03,2,2,2-2-A,정치,3,',
  'G2S2-04,2,2,2-2-A,동아시아 역사기행,3,', 'G2S2-05,2,2,2-2-A,역학과 에너지,3,G2S1-05',
  'G2S2-06,2,2,2-2-A,물질과 에너지,3,G2S1-06', 'G2S2-07,2,2,2-2-A,세포와 물질대사,3,G2S1-07',
  'G2S2-08,2,2,2-2-A,지구시스템과학,3,G2S1-08', 'G2S2-09,2,2,2-2-B,로봇과 공학세계,3,',
  'G2S2-10,2,2,2-2-B,인공지능 기초,3,', 'G2S2-11,2,2,2-2-B,언어생활과 한자,3,', 'G2S2-12,2,2,2-2-B,중국 문화,3,',
  'G2S2-13,2,2,2-2-B,일본어 회화,3,', 'G2S2-14,2,2,2-2-B,주제 탐구 독서,3,', 'G2S2-15,2,2,2-2-B,미디어 영어,3,',
  'G2S2-16,2,2,2-2-B,디자인 일반,3,', 'G2S2-17,2,2,2-2-B,음악감상과 비평(2학기),3,',
  'G3S1-01,3,1,3-1-A,미적분Ⅱ,3,', 'G3S1-02,3,1,3-1-A,인문학과 윤리,3,', 'G3S1-03,3,1,3-1-A,경제,3,',
  'G3S1-04,3,1,3-1-A,법과 사회,3,', 'G3S1-05,3,1,3-1-A,여행지리,3,', 'G3S1-06,3,1,3-1-A,역사로 탐구하는 현대세계,3,',
  'G3S1-07,3,1,3-1-A,전자기와 양자,3,G2S2-05', 'G3S1-08,3,1,3-1-A,화학 반응의 세계,3,G2S2-06',
  'G3S1-09,3,1,3-1-A,생물의 유전,3,G2S2-07', 'G3S1-10,3,1,3-1-A,행성우주과학,3,G2S2-08',
  'G3S1-11,3,1,3-1-A,과학의 역사와 문화,3,', 'G3S1-12,3,1,3-1-A,융합과학 탐구,3,',
  'G3S1-13,3,1,3-1-B,창의 공학 설계,3,', 'G3S1-14,3,1,3-1-B,생활과 한문,3,', 'G3S1-15,3,1,3-1-B,중국어 회화,3,',
  'G3S1-16,3,1,3-1-B,일본 문화,3,', 'G3S1-17,3,1,3-1-B,데이터 과학,3,', 'G3S1-18,3,1,3-1-B,경제 수학,3,',
  'G3S1-19,3,1,3-1-B,인공지능 수학,3,', 'G3S1-20,3,1,3-1-B,언어 생활 탐구,3,', 'G3S1-21,3,1,3-1-B,실생활 영어회화,3,',
  'G3S1-22,3,1,3-1-B,국제 관계의 이해,3,', 'G3S1-23,3,1,3-1-B,기후변화와 환경생태,3,', 'G3S1-24,3,1,3-1-B,조형,3,',
  'G3S1-25,3,1,3-1-B,운동과 건강,3,',
  'G3S2-01,3,2,3-2-A,독서토론과 글쓰기,3,', 'G3S2-02,3,2,3-2-A,실용통계,3,', 'G3S2-03,3,2,3-2-A,전문 수학,3,',
  'G3S2-04,3,2,3-2-A,심화 영어 독해와 작문,3,', 'G3S2-05,3,2,3-2-B,도시의 미래 탐구,3,',
  'G3S2-06,3,2,3-2-B,사회문제 탐구,3,', 'G3S2-07,3,2,3-2-B,기후변화와 지속가능한 세계,3,',
  'G3S2-08,3,2,3-2-B,역사로 탐구하는 현대세계,3,', 'G3S2-09,3,2,3-2-B,금융과 경제생활,3,',
  'G3S2-10,3,2,3-2-B,윤리문제 탐구,3,', 'G3S2-11,3,2,3-2-B,과학의 역사와 문화,3,', 'G3S2-12,3,2,3-2-B,융합과학 탐구,3,',
  'G3S2-13,3,2,3-2-B,기후변화와 환경생태,3,', 'G3S2-14,3,2,3-2-C,생활과학 탐구,3,',
  'G3S2-15,3,2,3-2-C,한문고전과 글쓰기,3,', 'G3S2-16,3,2,3-2-C,심화 중국어,3,', 'G3S2-17,3,2,3-2-C,심화 일본어,3,',
  'G3S2-18,3,2,3-2-C,소프트웨어와 생활,3,', 'G3S2-19,3,2,3-2-C,인공지능 수학,3,', 'G3S2-20,3,2,3-2-C,실생활 영어회화,3,',
  'G3S2-21,3,2,3-2-C,국제 관계의 이해,3,', 'G3S2-22,3,2,3-2-C,시각 디자인,3,', 'G3S2-23,3,2,3-2-C,운동과 건강,3,'
];

/** 처음 설치: 시트를 만들고 개설 과목·교사·설정을 넣는다. 학생 데이터는 넣지 않는다. */
function setup() {
  if (!ownerOnly_()) throw new Error('편집기에서만 실행할 수 있습니다.');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_DONE') === '1') {
    throw new Error('이미 설치되어 있습니다. 모든 데이터를 지우고 다시 만들려면 resetAll 을 실행하세요.');
  }
  buildAll_();
  props.setProperty('SETUP_DONE', '1');
}

/** 모든 시트를 지우고 처음 상태로 다시 만든다(되돌릴 수 없음) */
function resetAll() {
  if (!ownerOnly_()) throw new Error('편집기에서만 실행할 수 있습니다.');
  buildAll_();
  PropertiesService.getScriptProperties().setProperty('SETUP_DONE', '1');
}

/**
 * 시험용 신청자 12명을 등록한다(실제 운영 전에 관리자 화면의 "개인정보 일괄 삭제"로 지우세요).
 * 1학년(2학년 과목 교환): 10101~10106, 10201~10203 / 2학년(3학년 과목 교환): 20101~20103
 * 비밀번호는 모두 2580
 */
function addTestApplicants() {
  if (!ownerOnly_()) throw new Error('편집기에서만 실행할 수 있습니다.');
  var rows = read_('신청자');
  var have = {};
  rows.forEach(function (r) { have[r.학번] = true; });
  var list = [['10101', '김하늘'], ['10102', '이바다'], ['10103', '박서준'], ['10104', '최하윤'], ['10105', '정도윤'], ['10106', '강서연'],
    ['10201', '조민준'], ['10202', '윤지우'], ['10203', '장예준'], ['20101', '임하은'], ['20102', '한시우'], ['20103', '오수아']];
  var nowS = now_();
  var add = [];
  list.forEach(function (p) {
    if (have[p[0]]) return;
    var q = parseSid_(p[0]);
    var salt = Utilities.getUuid();
    add.push({ 학번: p[0], 이름: p[1], 학년: q.grade, 반: q.cls, 번호: q.no,
      비밀번호해시: hash_('2580', salt), 솔트: salt, 등록시각: nowS, 동의시각: nowS });
  });
  append_('신청자', add);
  log_('관리자(편집기)', '시험용 신청자 등록', '-', '', add.length + '명');
  Logger.log('시험용 신청자 ' + add.length + '명 등록. 비밀번호는 모두 2580');
}

function buildAll_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clearContents();
    var r = sh.getRange(1, 1, 1, SHEETS[name].length);
    r.setNumberFormat('@');
    r.setValues([SHEETS[name]]);
    r.setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  // 예전 버전에서 쓰던 시트가 있으면 개인정보가 남지 않도록 지운다
  ['학생', '수강', '연계묶음', '로그인기록'].forEach(function (n) { var sh = ss.getSheetByName(n); if (sh) ss.deleteSheet(sh); });
  var first = ss.getSheets()[0];
  if (!SHEETS[first.getName()] && ss.getSheets().length > Object.keys(SHEETS).length) {
    try { ss.deleteSheet(first); } catch (e) { /* 무시 */ }
  }

  var today = new Date();
  var start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0);
  var end = new Date(start.getTime() + 14 * 86400000 + (23 * 60 + 59) * 60000);
  var f = function (d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd HH:mm'); };
  write_('설정', [
    { 키: '신청시작', 값: f(start), 설명: 'yyyy-MM-dd HH:mm' },
    { 키: '신청마감', 값: f(end), 설명: 'yyyy-MM-dd HH:mm' },
    { 키: '동의기한(시간)', 값: '48', 설명: '매칭 후 학생이 동의해야 하는 시간' },
    { 키: '자동매칭', 값: 'OFF', 설명: 'ON이면 정해진 간격마다 자동 매칭' },
    { 키: '자동매칭간격(시간)', 값: '1', 설명: '1, 2, 4, 6, 8, 12 중 하나' },
    { 키: '웹앱주소', 값: '', 설명: '배포 후 웹앱 URL' },
    { 키: '반 수', 값: '12', 설명: '학생 화면 반 드롭다운 개수(1·2학년 중 많은 쪽)' },
    { 키: '반별 최대 번호', 값: '40', 설명: '학생 화면 번호 드롭다운 최대값' },
    { 키: '개인정보안내', 값: DEFAULT_NOTICE, 설명: '처음 신청 화면에 보이는 안내문' }
  ]);

  var courses = COURSE_SEED.map(function (line) {
    var p = line.split(',');
    var c = { 과목코드: p[0], 학년: p[1], 학기: p[2], 선택군: p[3], 과목명: p[4], 학점: p[5], 선수과목코드: p[6] || '' };
    c.표시명 = label_(c);
    return c;
  });
  write_('과목', courses);

  var teachers = [
    { 교사ID: 'admin', 이름: '교육과정부', 역할: '관리자', 담당학년: '', 담당반: '', pw: 'admin1234!' },
    { 교사ID: 't11', 이름: '1학년1반 담임', 역할: '담임', 담당학년: '1', 담당반: '1', pw: 'teacher11!' },
    { 교사ID: 't21', 이름: '2학년1반 담임', 역할: '담임', 담당학년: '2', 담당반: '1', pw: 'teacher21!' }
  ].map(function (t) {
    t.솔트 = Utilities.getUuid(); t.비밀번호해시 = hash_(t.pw, t.솔트); delete t.pw; return t;
  });
  write_('교사', teachers);
  ['신청자', '신청', '매칭', '이력'].forEach(function (n) { write_(n, []); });
  clearCache_();
  log_('관리자(편집기)', '초기 설치', '전체', '', '과목 ' + courses.length);
  Logger.log('설치 완료. 교사 로그인: admin / admin1234!  (t11 / teacher11!, t21 / teacher21!)');
  Logger.log('시험해 보려면 addTestApplicants 를 실행하세요(비밀번호 2580).');
}
