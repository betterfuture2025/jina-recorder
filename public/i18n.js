// 화면 문구 (한국어·영어). 새 문구는 두 언어에 같은 키로 넣는다.
export const STRINGS = {
  ko: {
    appDefault: '지나기록기',
    loading: '불러오는 중…',
    langToggle: 'EN',

    // 로그인
    loginTitle: '상담과 회의를 말로 남기세요',
    loginBody: '녹음하면 글로 바뀌고, 요약되어 기록으로 쌓입니다.',
    loginGoogle: 'Google로 로그인',
    loginOnlyAllowed: '관리자가 등록한 지메일만 들어올 수 있어요.',
    privacy: '개인정보 처리방침',
    err_not_allowed: '{email} 은(는) 아직 등록되지 않은 계정이에요. 관리자에게 등록을 요청해 주세요.',
    err_google_not_configured: '구글 로그인이 아직 설정되지 않았어요. 관리자에게 알려 주세요.',
    err_google_cancelled: '구글 로그인을 취소했어요.',
    err_google_error: '구글 로그인에서 오류가 났어요 ({code}). 설정이 반영되는 데 몇 분 걸릴 수 있어요. 잠시 뒤 다시 눌러 주세요.',
    err_state_mismatch: '로그인 시간이 지났어요. 다시 눌러 주세요.',
    err_google_token_failed: '구글에서 로그인을 확인하지 못했어요. 설정의 구글 연결을 확인해 주세요.',
    err_google_userinfo_failed: '구글 계정 정보를 받지 못했어요. 다시 시도해 주세요.',
    err_email_unverified: '확인되지 않은 이메일이에요.',
    err_google_unreachable: '구글에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.',

    // 처음 설치
    setupTitle: '처음 설치',
    setupBody: '관리자 계정과 구글 로그인을 연결하면 바로 쓸 수 있어요. 한 번만 하면 됩니다.',
    setupKey: '설치 코드',
    setupKeyHelp: '설치 스크립트가 마지막에 보여 준 코드예요.',
    setupAdmin: '관리자',
    setupAdminEmail: '관리자 지메일',
    setupAdminName: '이름',
    setupAppName: '사이트 이름',
    setupGoogle: '구글 로그인 연결',
    setupGoogleSteps: [
      'Google Cloud Console에서 <b>API 및 서비스 → 사용자 인증 정보</b>를 엽니다.',
      '처음이면 <b>OAuth 동의 화면</b>을 먼저 만들라고 나와요. 앱 이름과 이메일만 넣고, 대상은 <b>외부</b>를 고른 뒤 <b>앱 게시</b>까지 눌러 주세요.',
      '<b>사용자 인증 정보 만들기 → OAuth 클라이언트 ID</b>, 유형은 <b>웹 애플리케이션</b>을 고릅니다.',
      '<b>승인된 리디렉션 URI</b>에 아래 주소를 붙여 넣고 만듭니다.',
      '나온 클라이언트 ID와 보안 비밀번호를 아래에 넣습니다.',
    ],
    openConsole: 'Google Cloud Console 열기',
    redirectUri: '리디렉션 URI',
    copy: '복사',
    copied: '복사했어요',
    clientId: '클라이언트 ID',
    clientSecret: '클라이언트 보안 비밀번호',
    setupSubmit: '설치 마치기',
    setupDone: '설치를 마쳤어요. 관리자 지메일로 로그인하세요.',
    setupMissingSecrets: '서버 비밀값(ENC_KEY, SETUP_KEY)이 없거나 안내 문장 그대로예요. Cloudflare → Workers → jina-recorder → 설정 → 변수와 비밀에서 직접 정한 값으로 바꿔 주세요.',

    // 탭
    tabRecord: '녹음',
    tabRecords: '기록',
    tabAdmin: '관리',
    tabMe: '내 정보',

    // 홈 / 녹음
    quickRecord: '바로 녹음',
    quickRecordHint: '누르면 바로 시작해요. 누구와 한 건지는 나중에 정해도 돼요.',
    orChoose: '정하고 시작하기',
    kindMemo: '혼자 메모',
    kindMeeting: '회의',
    kindConsult: '상담',
    recordComingSoon: '녹음 기능은 파트 2에서 연결돼요.',
    recentTitle: '최근 기록',
    seeAll: '전체 보기',

    // 기록
    recordsTitle: '기록',
    recordsEmpty: '아직 기록이 없어요.',
    recordsEmptyBody: '녹음하면 날짜와 시간 순으로 여기에 쌓이고, 태그와 검색으로 찾을 수 있어요.',
    goRecord: '녹음하러 가기',
    unassigned: '미지정',

    // 관리 — 사용자
    adminTitle: '관리',
    adminUsers: '선생님 계정',
    adminSettings: '설정',
    usersBody: '여기 등록된 지메일만 로그인할 수 있어요.',
    addUser: '계정 추가',
    email: '지메일',
    name: '이름',
    role: '권한',
    roleTeacher: '선생님',
    roleAdmin: '관리자',
    add: '추가',
    active: '사용 중',
    inactive: '꺼짐',
    turnOff: '접속 막기',
    turnOn: '다시 허용',
    makeAdmin: '관리자로',
    makeTeacher: '선생님으로',
    remove: '삭제',
    confirmRemove: '{email} 계정을 삭제할까요? 기록이 있으면 접속만 막아요.',
    neverLoggedIn: '아직 로그인 안 함',
    lastLogin: '마지막 로그인 {when}',
    you: '나',
    userAdded: '{email} 을(를) 추가했어요.',
    userRemoved: '삭제했어요.',
    userDeactivated: '기록이 있어서 삭제 대신 접속을 막았어요.',
    saved: '저장했어요.',

    // 설정
    settingsBody: 'API 키와 연결은 모두 여기서 넣어요. 키는 암호화해서 저장해요.',
    secBasic: '기본',
    secGoogle: '구글 로그인',
    secAI: 'AI 연결',
    secEmail: '이메일 발송',
    secDrive: '구글 드라이브',
    secAIDesc: '음성 변환·요약에 쓸 AI를 여러 개 등록하고 용도별로 골라요.',
    secEmailDesc: 'Resend로 요약 이메일을 보내요.',
    secDriveDesc: '요약과 원본 녹음을 드라이브 폴더로 자동으로 올려요.',
    comingInPart: '파트 {n}에서 열려요',
    secretSet: '저장됨 {hint}',
    secretPlaceholder: '바꿀 때만 새로 입력',
    save: '저장',
    testConnection: '연결 테스트',
    testOk: '연결됐어요. 클라이언트 ID와 비밀번호가 맞아요.',
    test_missing: '클라이언트 ID와 비밀번호를 먼저 저장해 주세요.',
    test_invalid_client: '클라이언트 ID나 비밀번호가 맞지 않아요.',
    test_redirect_uri_mismatch: '리디렉션 URI가 구글에 등록된 것과 달라요.',
    test_network: '구글에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.',
    testFailed: '확인하지 못했어요 ({reason}).',

    // 내 정보
    meTitle: '내 정보',
    language: '언어',
    installTitle: '홈 화면에 추가',
    installBody: '앱처럼 바로 열리고, 로그인도 계속 유지돼요.',
    installButton: '홈 화면에 추가',
    installIos: '사파리 아래쪽 공유 버튼을 누르고 <b>홈 화면에 추가</b>를 고르세요.',
    installDone: '이미 홈 화면에서 열고 있어요.',
    logout: '로그아웃',

    // 오류
    networkError: '인터넷 연결을 확인해 주세요.',
    genericError: '문제가 생겼어요. 다시 해 주세요.',
    retry: '다시 시도',
  },

  en: {
    appDefault: 'Jina Recorder',
    loading: 'Loading…',
    langToggle: '한국어',

    loginTitle: 'Keep consultations and meetings by voice',
    loginBody: 'Record, and it turns into text, gets summarised and filed.',
    loginGoogle: 'Sign in with Google',
    loginOnlyAllowed: 'Only Gmail accounts added by an admin can sign in.',
    privacy: 'Privacy policy',
    err_not_allowed: '{email} hasn’t been added yet. Ask an admin to add you.',
    err_google_not_configured: 'Google sign-in isn’t set up yet. Let an admin know.',
    err_google_cancelled: 'Google sign-in was cancelled.',
    err_google_error: 'Google sign-in returned an error ({code}). New settings can take a few minutes to apply. Try again shortly.',
    err_state_mismatch: 'The sign-in took too long. Tap the button again.',
    err_google_token_failed: 'Google couldn’t confirm the sign-in. Check the Google connection in Settings.',
    err_google_userinfo_failed: 'Couldn’t get your Google account details. Try again.',
    err_email_unverified: 'This email isn’t verified.',
    err_google_unreachable: 'Couldn’t reach Google. Try again in a moment.',

    setupTitle: 'First-time setup',
    setupBody: 'Connect an admin account and Google sign-in and you’re ready. You only do this once.',
    setupKey: 'Setup code',
    setupKeyHelp: 'The code shown at the end of the setup script.',
    setupAdmin: 'Admin',
    setupAdminEmail: 'Admin Gmail',
    setupAdminName: 'Name',
    setupAppName: 'Site name',
    setupGoogle: 'Connect Google sign-in',
    setupGoogleSteps: [
      'In Google Cloud Console, open <b>APIs & Services → Credentials</b>.',
      'If asked, set up the <b>OAuth consent screen</b> first: app name and email only, audience <b>External</b>, then <b>Publish app</b>.',
      'Choose <b>Create credentials → OAuth client ID</b>, type <b>Web application</b>.',
      'Paste the address below into <b>Authorised redirect URIs</b> and create it.',
      'Enter the client ID and client secret you get below.',
    ],
    openConsole: 'Open Google Cloud Console',
    redirectUri: 'Redirect URI',
    copy: 'Copy',
    copied: 'Copied',
    clientId: 'Client ID',
    clientSecret: 'Client secret',
    setupSubmit: 'Finish setup',
    setupDone: 'Setup is done. Sign in with the admin Gmail.',
    setupMissingSecrets: 'Server secrets (ENC_KEY, SETUP_KEY) are missing or still the example text. Change them in Cloudflare → Workers → jina-recorder → Settings → Variables and Secrets.',

    tabRecord: 'Record',
    tabRecords: 'Notes',
    tabAdmin: 'Admin',
    tabMe: 'Me',

    quickRecord: 'Record now',
    quickRecordHint: 'Starts straight away. You can say who it was with later.',
    orChoose: 'Choose first',
    kindMemo: 'Memo',
    kindMeeting: 'Meeting',
    kindConsult: 'Consultation',
    recordComingSoon: 'Recording is connected in part 2.',
    recentTitle: 'Recent notes',
    seeAll: 'See all',

    recordsTitle: 'Notes',
    recordsEmpty: 'No notes yet.',
    recordsEmptyBody: 'Recordings land here by date and time, and you can find them by tag or search.',
    goRecord: 'Go to recording',
    unassigned: 'Unassigned',

    adminTitle: 'Admin',
    adminUsers: 'Teacher accounts',
    adminSettings: 'Settings',
    usersBody: 'Only Gmail accounts listed here can sign in.',
    addUser: 'Add account',
    email: 'Gmail',
    name: 'Name',
    role: 'Role',
    roleTeacher: 'Teacher',
    roleAdmin: 'Admin',
    add: 'Add',
    active: 'Active',
    inactive: 'Off',
    turnOff: 'Block access',
    turnOn: 'Allow again',
    makeAdmin: 'Make admin',
    makeTeacher: 'Make teacher',
    remove: 'Delete',
    confirmRemove: 'Delete {email}? If they have notes, access is blocked instead.',
    neverLoggedIn: 'Hasn’t signed in yet',
    lastLogin: 'Last signed in {when}',
    you: 'You',
    userAdded: 'Added {email}.',
    userRemoved: 'Deleted.',
    userDeactivated: 'They have notes, so access was blocked instead of deleting.',
    saved: 'Saved.',

    settingsBody: 'All API keys and connections go here. Keys are stored encrypted.',
    secBasic: 'Basics',
    secGoogle: 'Google sign-in',
    secAI: 'AI connections',
    secEmail: 'Email',
    secDrive: 'Google Drive',
    secAIDesc: 'Add several AI services for transcription and summaries, and pick one per job.',
    secEmailDesc: 'Send summary emails through Resend.',
    secDriveDesc: 'Copy summaries and original recordings into a Drive folder automatically.',
    comingInPart: 'Opens in part {n}',
    secretSet: 'Saved {hint}',
    secretPlaceholder: 'Enter only to change',
    save: 'Save',
    testConnection: 'Test connection',
    testOk: 'Connected. The client ID and secret are correct.',
    test_missing: 'Save the client ID and secret first.',
    test_invalid_client: 'The client ID or secret is wrong.',
    test_redirect_uri_mismatch: 'The redirect URI doesn’t match the one registered with Google.',
    test_network: 'Couldn’t reach Google. Try again in a moment.',
    testFailed: 'Couldn’t confirm ({reason}).',

    meTitle: 'Me',
    language: 'Language',
    installTitle: 'Add to home screen',
    installBody: 'Opens like an app and keeps you signed in.',
    installButton: 'Add to home screen',
    installIos: 'Tap the Share button in Safari, then <b>Add to Home Screen</b>.',
    installDone: 'You’re already using it from the home screen.',
    logout: 'Sign out',

    networkError: 'Check your internet connection.',
    genericError: 'Something went wrong. Try again.',
    retry: 'Try again',
  },
};

let lang = 'ko';
try {
  const saved = localStorage.getItem('vn_lang');
  if (saved === 'ko' || saved === 'en') lang = saved;
  else if (!navigator.language.startsWith('ko')) lang = 'en';
} catch {}

export function getLang() { return lang; }

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'ko';
  try { localStorage.setItem('vn_lang', lang); } catch {}
  document.documentElement.lang = lang;
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 문구 안의 {이름} 자리에 값을 넣는다. 넣는 값은 항상 안전하게 바꿔서 넣는다.
export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.ko[key] ?? key;
  if (typeof s !== 'string') return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => esc(vars[k] ?? ''));
}
