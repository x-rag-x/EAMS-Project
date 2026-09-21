function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

var currentUser  = null;
var deptsData    = [];
var examsData    = [];
var calendarData = {};
var eaStudentList= [];
var _dmDayType   = 'working';
var _dmWorking   = true;
var _hasLocalDraft = false;

// Utils
function pad2(n){ return String(n).padStart(2,'0'); }
function todayStr(){ return new Date().toISOString().split('T')[0]; }
function fmtDate(s){ if(!s) return '—'; var d=new Date(s+'T00:00:00'); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function normalizeCalDateKey(d){
  if(!d) return '';
  if(typeof d === 'object' && d !== null) {
    if(d.dateKey) return d.dateKey;
    d = d.date;
  }
  if(!d) return '';
  if(typeof d === 'string') {
    if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if(d.indexOf('T') !== -1) return d.split('T')[0];
  }
  var dt = new Date(d);
  if(!isNaN(dt.getTime())) {
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }
  return String(d).split('T')[0];
}
function examDates(ex){
  var arr=(ex&&Array.isArray(ex.Dates))?ex.Dates.slice().sort():[];
  return { start: arr[0]||'', end: arr[arr.length-1]||'' };
}

// Boot
(function() {
  currentUser = checkAuth("admin", "managePage");
  if (!currentUser) return;

  // Loader message sequence (3 s total)
  var LOADER_STEPS = [
    { t:    0, msg: 'Initializing EAMS…' },
    { t: 700, msg: 'Connecting to Database…' },
    { t: 1200, msg: 'Fetching from Database…' },
    { t: 2200, msg: 'Almost ready…' },
  ];

  var loaderMsgEl = document.getElementById('loader-msg');

  function setLoaderMsg(idx, text) {
    if (!loaderMsgEl) return;
    loaderMsgEl.classList.add('msg-fade');
    setTimeout(function () {
      loaderMsgEl.textContent = text;
      loaderMsgEl.classList.remove('msg-fade');
      // Advance step dots (5 dots, indices 0-4)
      for (var s = 0; s < 5; s++) {
        var dot = document.getElementById('lstep-' + s);
        if (!dot) continue;
        dot.className = 'loader-step' + (s < idx ? ' done' : s === idx ? ' active' : '');
      }
    }, 130);
  }

  LOADER_STEPS.forEach(function (step, i) {
    if (i === 0) return; // first already set in HTML
    setTimeout(function () { setLoaderMsg(i, step.msg); }, step.t);
  });

  // Gate: both 3 s timer AND real sync must finish
  var timerDone = false;
  var fetchDone = false;
  var fetchCb   = null; // store the nav callback until gate opens

  function tryReveal() {
    if (!timerDone || !fetchDone) return;
    // Flush any toasts that fired during loading
    _loaderActive = false;
    var loader = document.getElementById('page-loader');
    if (loader) {
      loader.classList.add('loader-fade');
      setTimeout(function () {
        loader.style.display = 'none';
        // Fire queued toasts after loader is visually gone
        _toastQueue.forEach(function (a) { dbToast(a[0], a[1], a[2]); });
        _toastQueue = [];
      }, 360);
    }
    document.getElementById('app-shell').classList.add('vis');
    if (fetchCb) fetchCb();
  }

  // 3-second minimum display
  setTimeout(function () { timerDone = true; tryReveal(); }, 3000);

  var nm = currentUser.name || 'Admin', av = nm[0].toUpperCase();
  ['sb-av','topbar-av'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent=av; });
  ['sb-name','topbar-name'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent=nm; });
  
  var backBtn = document.querySelector('.sb-back-btn');
  if (backBtn) {
    if (currentUser && currentUser.role === 'teacher') {
      var roleEl = document.querySelector('.sb-urole');
      if (roleEl) roleEl.textContent = 'Teacher (Admin)';
      backBtn.textContent = '← Back to Hub';
    } else {
      backBtn.textContent = '← Back to Dashboard';
    }
  }

  // Dynamic Settings & Tri-State Guard
  fetch('/api/settings/public')
    .then(function (r) { return r.json(); })
    .then(function (pub) {
      if (pub.institution) {
        var instShort = pub.institution.institutionShort || '';
        document.title = instShort ? ('EAMS – Manage | ' + instShort) : 'EAMS – Manage';
        var logoImg = document.getElementById('topbar-logo');
        if (logoImg && pub.institution.institutionLogoUrl) logoImg.src = pub.institution.institutionLogoUrl;
        var brandSub = document.getElementById('manage-brand-sub');
        if (brandSub && pub.institution.institutionShort) {
          brandSub.textContent = pub.institution.institutionShort + ' EAMS';
        }
      }
      if (currentUser && currentUser.role !== 'admin') {
        var pState = pub.pages ? pub.pages.pageManage : 'enabled';
        if (pState === 'hidden') {
          window.location.href = 'teacher.html';
          return;
        } else if (pState === 'disabled') {
          alert('Data & Exam Management portal is currently disabled for maintenance.');
          window.location.href = 'selector.html';
          return;
        }
      }
      if (pub.models) {
        if (pub.models.modelExams === false) {
          var examNav = document.getElementById('nav-exams');
          if (examNav) examNav.style.display = 'none';
        }
        if (pub.models.modelExportSheet === false) {
          document.querySelectorAll('.btn-export').forEach(function(b){ b.style.display = 'none'; });
        }
      }
    })
    .catch(function (e) { console.warn('Public settings fetch error', e); });

  document.getElementById('tdt-label').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  var now = new Date();
  var mSel = document.getElementById('cal-month-sel');
  var yInp = document.getElementById('cal-year-inp');
  if(mSel) mSel.value = now.getMonth() + 1;
  if(yInp) yInp.value = now.getFullYear();
  loadDepts();
  loadOverview();
  loadYears();

  fetchDone = true;
  var urlParams = new URLSearchParams(window.location.search);
  var initialTab = urlParams.get('tab') || urlParams.get('page');
  if (initialTab && ['overview', 'calendar', 'exam', 'years', 'settings'].indexOf(initialTab) !== -1) {
    nav(initialTab);
  }
  tryReveal();
})();

function goBack() {
  if (currentUser && currentUser.role === 'teacher') {
    window.location.href = "selector.html";
  } else {
    window.location.href = "admin.html";
  }
}

// Helpers

(function () {
  async function checkSessionExpiry() {
  try {
      const session = await apiCall('GET', '/auth/login-history');
      if (!session || !session.expireTime) return;

      const remainingTime = new Date(session.expireTime).getTime() - Date.now();

      // Already expired
      if (remainingTime <= 0) {
      showToast('⚠️ Session expired. Logging out...', 'error');
      return setTimeout(() => { doLogout('timeout', 'error'); }, 1000);
      }

      sessionStorage.setItem('eams_expire_time', session.expireTime);
  } catch (err) {
      console.warn('Session verification failed:', err);
  }
  }

  // Poll every 15s to catch server-side invalidation early
  setInterval(checkSessionExpiry, 15000);
  checkSessionExpiry();
})();

// Sidebar toggle
function toggleSidebar() {
  var isMobile = window.innerWidth <= 768;
  if (isMobile) {
    var sb = document.querySelector('.sb');
    var ov = document.getElementById('sb-overlay');
    var btn = document.getElementById('sbtoggle');
    if (sb) sb.classList.toggle('sb-mobile-open');
    if (ov) ov.classList.toggle('visible');
    if (btn) btn.innerHTML = (sb && sb.classList.contains('sb-mobile-open')) ? '✖' : '☰';
  } else {
    var sb = document.querySelector('.sb');
    var mc = document.querySelector('.mc');
    if (sb) sb.classList.toggle('sb-hidden');
    if (mc) mc.classList.toggle('sb-expanded');
  }
}

// Navigation
function nav(page) {
  if (['overview', 'calendar', 'exam', 'years', 'settings'].indexOf(page) === -1) page = 'overview';

  if (window.history && window.history.replaceState) {
    var url = new URL(window.location);
    url.searchParams.set('tab', page);
    window.history.replaceState(null, '', url);
  }

  document.querySelectorAll('.pg').forEach(function(p){ p.classList.remove('act'); });
  var pg = document.getElementById('pg-'+page); if(pg) pg.classList.add('act');
  document.querySelectorAll('.sb-item').forEach(function(b){ b.classList.remove('act'); });
  var btn = document.querySelector('[data-page="'+page+'"]'); if(btn) btn.classList.add('act');
  if(page==='overview')  loadOverview();
  if(page==='calendar')  loadCalendar();
  if(page==='exam')      { loadExams(); populateExamSel(); populateDeptCheckboxes(); }
  if(page==='years')     loadYears();
  if(page==='settings')  loadManageAdmins();
}

// OVERVIEW
function loadOverview() {
  var now = new Date(), m = now.getMonth()+1, y = now.getFullYear();
  document.getElementById('ov-month-label').textContent = ['','January','February','March','April','May','June','July','August','September','October','November','December'][m]+' '+y;
  apiCall('GET','/calendar?month='+m+'&year='+y).then(function(days){
    var map={}; (Array.isArray(days)?days:[]).forEach(function(d){ var key=normalizeCalDateKey(d.dateKey || d.date || d); map[key]=d; });
    renderCalGrid(map,m,y,'ov-cal-grid',true);
    var stats={working:0,leave:0,exam:0,total:new Date(y,m,0).getDate()};
    for(var day=1;day<=stats.total;day++){
      var ds=y+'-'+pad2(m)+'-'+pad2(day),d=map[ds],dow=new Date(ds+'T00:00:00').getDay();
      var eff=getEffType(d,dow,day,m,y);
      if(eff.type==='exam')stats.exam++; else if(!eff.working)stats.leave++; else stats.working++;
    }
    document.getElementById('ov-working').textContent = stats.working;
    document.getElementById('ov-leave').textContent   = stats.leave;
    document.getElementById('ov-exam').textContent    = stats.exam;
    document.getElementById('ov-total').textContent   = stats.total;

  }).catch(function(){ renderCalGrid({} , m, y, 'ov-cal-grid', true); });

  apiCall('GET','/exams/active').then(function(data){
    renderUpcomingExams(Array.isArray(data)?data:[]);
  }).catch(function(){
    var cont = document.getElementById('ov-exams-list');
    if (cont) cont.innerHTML = '<div style="text-align:center;padding:24px;color:var(--tdi);font-size:12px;">No upcoming exams.</div>';
  });
}

function renderUpcomingExams(exams) {
  var cont = document.getElementById('ov-exams-list');
  if(!exams.length){ cont.innerHTML='<div style="text-align:center;padding:24px;color:var(--tdi);font-size:12px;">No upcoming exams.</div>'; return; }
  var typeIcons={'Internal 1':'📘','Internal 2':'📙','Practicals':'🔬','Semester':'📚'};
  var typeColors={'Internal 1':'#eff6ff','Internal 2':'#fdf4ff','Practicals':'#fff7ed','Semester':'#fef2f2'};
  var html='';
  exams.slice(0,8).forEach(function(ex){
    var ic=typeIcons[ex.examType]||'📄';
    var col=typeColors[ex.examType]||'#f3f4f6';
    var rng=examDates(ex);
    var statusPill = ex.status==='ongoing'?'<span class="bge bgg">Ongoing</span>':'<span class="bge bgb">'+ex.status+'</span>';
    html+='<div class="upcoming-exam">'
      +'<div class="ue-type-ic" style="background:'+col+'">'+ic+'</div>'
      +'<div class="ue-info"><div class="ue-title">'+ex.title+'</div>'
      +'<div class="ue-meta">'+fmtDate(rng.start)+' – '+fmtDate(rng.end)+' &nbsp;|&nbsp; Sem '+ex.semester+' &nbsp;'+statusPill+'</div></div>'
      +'</div>';
  });
  cont.innerHTML = html;
}

// CALENDAR HELPERS
function getSatOrdinal(day, month, year) {
  var count=0;
  for(var d=1;d<=day;d++){ if(new Date(year,month-1,d).getDay()===6) count++; }
  return count;
}
function getEffType(doc, dow, day, month, year) {
  if(doc) {
    // Local auto-fill format: has top-level dayType/isWorkingDay
    if(doc._local || doc.dayType) {
      return { type: doc.dayType||'working', working: doc.isWorkingDay!==undefined?doc.isWorkingDay:(doc.dayType!=='leave'), timing: doc.timing||{start:'08:30',end:'16:30'} };
    }
    // DB format: read from details[] array
    if(doc.details && doc.details.length > 0) {
      var yf = (typeof document !== 'undefined' && document.getElementById('cal-year-filter')) ? document.getElementById('cal-year-filter').value : '';
      var det = null;
      if (yf) {
        det = doc.details.find(function(d) { return d.year === yf; });
      }
      if (!det) {
        det = doc.details.find(function(d) { return d.dayType === 'exam'; }) || doc.details.find(function(d) { return d.dayType === 'leave'; }) || doc.details[0];
      }
      var dtype = (det && det.dayType) ? det.dayType : 'working';
      var isWork = (dtype === 'working' || dtype === 'exam' || dtype === 'half-day');
      var tim = (det && det.timing) ? det.timing : {start:'08:30',end:'16:30'};
      return { type: dtype, working: isWork, timing: tim };
    }
    return { type:'working', working:true, timing:{start:'08:30',end:'16:30'} };
  }
  if(dow===0) return { type:'leave', working:false, timing:{start:'08:30',end:'16:30'} };
  if(dow===6){ var sn=getSatOrdinal(day,month,year); var w=(sn%2===0 || sn===5); return { type:w?'working':'leave', working:w, timing:{start:'08:30',end:'16:30'} }; }
  return { type:'working', working:true, timing:{start:'08:30',end:'16:30'} };
}

function renderCalGrid(map, month, year, gridId, readonly) {
  var grid=document.getElementById(gridId); if(!grid) return;
  var today=todayStr(), lastDay=new Date(year,month,0).getDate();
  var firstDow=new Date(year,month-1,1).getDay();
  var offset=(firstDow===0)?6:firstDow-1;
  var cells='';
  for(var i=0;i<offset;i++) cells+='<div class="cal-cell other-month"></div>';
  for(var day=1;day<=lastDay;day++){
    var ds=year+'-'+pad2(month)+'-'+pad2(day);
    var dow=new Date(year, month-1, day).getDay(), isSun=dow===0, isSat=dow===6;
    var doc=map[ds];

    var cls, typeLabel, typeLabelColor, timingStr='', yrBadges='';

    if(!doc){
      // Not Saved State: clean neutral / black style (no green or red)
      cls='cal-cell not-set' + (ds===today?' today':'') + (readonly?' readonly':'');
      typeLabel='—';
      typeLabelColor='var(--tmu)';
    } else {
      var eff=getEffType(doc,dow,day,month,year);
      cls='cal-cell '+eff.type+(isSun?' sunday':'')+(isSat?' saturday':'')+(ds===today?' today':'')+(readonly?' readonly':'');
      typeLabel=eff.type.charAt(0).toUpperCase()+eff.type.slice(1).replace('-',' ');
      typeLabelColor=eff.working?(eff.type==='exam'?'#b45309':'var(--gK)'):'#dc2626';
      timingStr=(eff.working&&eff.timing&&eff.timing.start)?'<div style="font-size:7.5px;color:var(--tmu);">'+eff.timing.start+'–'+eff.timing.end+'</div>':'';
      
      var examYears = (doc.details || []).filter(function(d){ return d.dayType === 'exam'; }).map(function(d){ return d.year; });
      if(examYears.length > 0){
        yrBadges='<div class="cal-yr-badges">';
        examYears.forEach(function(yr){ yrBadges+='<span class="cal-yr-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">Yr '+yr+'</span>'; });
        yrBadges+='</div>';
      } else if(doc.affectedYears&&doc.affectedYears.length>0){
        yrBadges='<div class="cal-yr-badges">';
        doc.affectedYears.forEach(function(yr){ yrBadges+='<span class="cal-yr-badge">'+yr+'</span>'; });
        yrBadges+='</div>';
      }
    }

    var onclick=readonly?'':' onclick="openDayModal(\''+ds+'\')"';
    cells+='<div class="'+cls+'"'+onclick+'>'
      +'<div class="cal-date">'+day+'</div>'
      +'<div class="cal-type-label" style="color:'+typeLabelColor+';">'+typeLabel+'</div>'
      +timingStr+yrBadges+'</div>';
  }
  grid.innerHTML=cells;
}

// COLLEGE DAYS
function prevMonth(){
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  if(m===1){m=12;y--;}else{m--;}
  document.getElementById('cal-month-sel').value=m; document.getElementById('cal-year-inp').value=y;
  loadCalendar();
}
function nextMonth(){
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  if(m===12){m=1;y++;}else{m++;}
  document.getElementById('cal-month-sel').value=m; document.getElementById('cal-year-inp').value=y;
  loadCalendar();
}
// CALENDAR DRAFT ENCRYPTION & SESSIONSTORAGE
function getCalDraftStorageKey(m, y) {
  return 'eams_cal_draft_' + y + '_' + pad2(m);
}

function encryptCalDraft(data) {
  try {
    var str = JSON.stringify(data);
    var key = 'EAMS_CAL_SECRET_' + (currentUser ? currentUser._id || 'KEY' : 'KEY');
    var enc = '';
    for (var i = 0; i < str.length; i++) {
      enc += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(unescape(encodeURIComponent(enc)));
  } catch (e) {
    try { return btoa(encodeURIComponent(JSON.stringify(data))); } catch (e2) { return ''; }
  }
}

function decryptCalDraft(cipher) {
  if (!cipher) return null;
  try {
    var raw = decodeURIComponent(escape(atob(cipher)));
    var key = 'EAMS_CAL_SECRET_' + (currentUser ? currentUser._id || 'KEY' : 'KEY');
    var dec = '';
    for (var i = 0; i < raw.length; i++) {
      dec += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return JSON.parse(dec);
  } catch (e) {
    try {
      return JSON.parse(decodeURIComponent(atob(cipher)));
    } catch (e2) {
      return null;
    }
  }
}

function saveCalDraftToSession(m, y) {
  var key = getCalDraftStorageKey(m, y);
  sessionStorage.setItem(key, encryptCalDraft(calendarData));
  _hasLocalDraft = true;
  var clrBtn = document.getElementById('clear-draft-btn');
  if (clrBtn) clrBtn.style.display = '';
}

function clearCalDraftFromSession(m, y) {
  var key = getCalDraftStorageKey(m, y);
  sessionStorage.removeItem(key);
  _hasLocalDraft = false;
  var clrBtn = document.getElementById('clear-draft-btn');
  if (clrBtn) clrBtn.style.display = 'none';
}

function loadCalendar(){
  var m=parseInt(document.getElementById('cal-month-sel').value);
  var y=parseInt(document.getElementById('cal-year-inp').value);
  var yf=document.getElementById('cal-year-filter').value;
  
  var mn=['','January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month-label').textContent=mn[m]+' '+y;
  document.getElementById('month-label').textContent=mn[m]+' '+y;

  // Check if encrypted draft exists in sessionStorage for this month/year
  var draftCipher = sessionStorage.getItem(getCalDraftStorageKey(m, y));
  var localDraft = decryptCalDraft(draftCipher);

  if (localDraft && Object.keys(localDraft).length > 0) {
    calendarData = localDraft;
    _hasLocalDraft = true;
    var clrBtn = document.getElementById('clear-draft-btn');
    if (clrBtn) clrBtn.style.display = '';

    var renderMap = {};
    Object.keys(calendarData).forEach(function(k){ renderMap[k]=calendarData[k]; });
    if(yf){
      var fmap={};
      Object.keys(renderMap).forEach(function(k){ var d=renderMap[k];
        var hasYear = false;
        if(d.details && d.details.length > 0) hasYear = d.details.some(function(det){ return det.year === yf; });
  dbToast('Syncing from database…','saving');

        if(!d.details || d.details.length===0 || hasYear) fmap[k]=d;
      });
      renderMap=fmap;
    }
    renderCalGrid(renderMap, m, y, 'cal-grid', false);
    updateCalStats(m, y);
    var badge = document.getElementById('cal-finalized-badge');
    if (badge) { badge.textContent = '📝 Local Draft'; badge.style.color = '#b45309'; }
    return;
  }

  _hasLocalDraft = false;
  var clrBtn = document.getElementById('clear-draft-btn');
  if(clrBtn) clrBtn.style.display = 'none';

  document.getElementById('cal-grid').innerHTML='<div style="grid-column:span 7;text-align:center;padding:20px;color:var(--tdi);font-size:16px;">Loading… This may take few seconds.</div>';
  apiCall('GET','/calendar?month='+m+'&year='+y).then(function(days){
    var map={}; (Array.isArray(days)?days:[]).forEach(function(d){ var key=normalizeCalDateKey(d.dateKey || d.date || d); map[key]=d; });
    calendarData=map;
    updateFinalizedBadge(days);
    // Apply year filter
    if(yf){
      var fmap={};
      Object.keys(map).forEach(function(k){ var d=map[k];
        var hasYear = false;
        if(d.details && d.details.length > 0){
          hasYear = d.details.some(function(det){ return det.year === yf; });
        }
        if(!d.details || d.details.length===0 || hasYear) fmap[k]=d;
      });
      map=fmap;
    }
    renderCalGrid(map,m,y,'cal-grid',false);
    updateCalStats(m,y);
    dbToast('Synced successfully','success');
  }).catch(function(){ 
    renderCalGrid({},m,y,'cal-grid',false); 
    updateFinalizedBadge([]); 
    dbToast('Sync failed','error');
  });
}

function updateCalStats(m,y){
  var lastDay=new Date(y,m,0).getDate();
  var stats={working:0,leave:0,exam:0,total:lastDay};
  for(var day=1;day<=lastDay;day++){
    var ds=y+'-'+pad2(m)+'-'+pad2(day),doc=calendarData[ds],dow=new Date(y, m-1, day).getDay();
    var eff=getEffType(doc,dow,day,m,y);
    if(eff.type==='exam')stats.exam++; else if(!eff.working)stats.leave++; else stats.working++;
  }
  document.getElementById('cs-working').textContent=stats.working;
  document.getElementById('cs-leave').textContent=stats.leave;
  document.getElementById('cs-exam').textContent=stats.exam;
  document.getElementById('cs-total').textContent=stats.total;
}

function generateMonthDefaults(){
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  var lastDay=new Date(y,m,0).getDate();
  calendarData = {};
  for(var day=1;day<=lastDay;day++){
    var ds=y+'-'+pad2(m)+'-'+pad2(day);
    var dow=new Date(y, m-1, day).getDay();
    var dayType;
    if(dow===0){ dayType='leave'; }
    else if(dow===6){ var sn=getSatOrdinal(day,m,y); dayType=(sn%2===0 || sn===5)?'working':'leave'; }
    else{ dayType='working'; }
    var isWorking=(dayType==='working');
    var details=['I','II','III','IV'].map(function(yr){ return {year:yr,dayType:dayType,comments:'',timing:{start:'08:30',end:'16:30'}}; });
    calendarData[ds]={date:ds,dayType:dayType,isWorkingDay:isWorking,details:details,timing:{start:'08:30',end:'16:30'},_local:true};
  }
  
  // Persist encrypted draft to sessionStorage
  saveCalDraftToSession(m, y);

  // Re-render
  var yf=document.getElementById('cal-year-filter').value;
  var renderMap={};
  Object.keys(calendarData).forEach(function(k){ renderMap[k]=calendarData[k]; });
  if(yf){
    var fmap={};
    Object.keys(renderMap).forEach(function(k){ var d=renderMap[k];
      var hasYear = false;
      if(d.details && d.details.length > 0) hasYear = d.details.some(function(det){ return det.year === yf; });
      if(!d.details || d.details.length===0 || hasYear) fmap[k]=d;
    });
    renderMap=fmap;
  }
  renderCalGrid(renderMap,m,y,'cal-grid',false);
  updateCalStats(m,y);
  var badge = document.getElementById('cal-finalized-badge');
  if (badge) { badge.textContent = '📝 Local Draft'; badge.style.color = '#b45309'; }
  dbToast('Month auto-filled locally and saved to session draft. Click Save Draft or Save & Finalize to push to DB.','success');
}

function clearCalendarDraft(){
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  clearCalDraftFromSession(m, y);
  loadCalendar();
  dbToast('Session draft cleared. Synced with DB.','success');
}

function deleteCalendarMonth(){
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  var mn=['','January','February','March','April','May','June','July','August','September','October','November','December'];
  
  // Update modal label with month and year
  document.getElementById('dmm-month-label').textContent = mn[m] + ' ' + y;
  
  // Open confirmation modal
  openModal('delete-month-modal-bg');
}

function confirmDeleteCalendarMonth(){
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  
  closeModal('delete-month-modal-bg');
  clearCalDraftFromSession(m, y);
  dbToast('Deleting month from DB…','saving');
  apiCall('DELETE','/calendar/month/clear?month='+m+'&year='+y).then(function(r){
    dbToast('Month deleted from DB','success', (r.deletedCount||0)+' days removed');
    loadCalendar();
  }).catch(function(err){
    dbToast('Error: '+(err&&err.message?err.message:'Server error'),'error');
  });
}

function updateFinalizedBadge(days){
  var badge=document.getElementById('cal-finalized-badge');
  if(!badge) return;
  var arr=Array.isArray(days)?days:[];
  if(arr.length===0){
    badge.textContent='Not Saved';
    badge.style.color='#6b7280';
    return;
  }
  var allFinalized=arr.every(function(d){ return d.isFinalized===true; });
  if(allFinalized){
    badge.textContent='✅ Finalized';
    badge.style.color='var(--gK,#16a34a)';
  } else {
    badge.textContent='💾 DB Draft';
    badge.style.color='#d97706';
  }
}

function saveCalendarMonth(finalize){
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  var lastDay=new Date(y,m,0).getDate();
  var daysToSave=[];
  
  dbToast(finalize?'Finalizing month in DB…':'Saving drafts in DB…','saving');
  
  for(var day=1;day<=lastDay;day++){
    var ds=y+'-'+pad2(m)+'-'+pad2(day);
    var doc=calendarData[ds];
    var details;
    if(doc && doc.details && doc.details.length>0){
      details=doc.details;
    } else {
      var dow=new Date(y, m-1, day).getDay();
      var dayType;
      if(dow===0){ dayType='leave'; }
      else if(dow===6){ var sn=getSatOrdinal(day,m,y); dayType=(sn%2===0 || sn===5)?'working':'leave'; }
      else{ dayType='working'; }
      details=['I','II','III','IV'].map(function(yr){ return {year:yr,dayType:dayType,comments:'',timing:{start:'08:30',end:'16:30'}}; });
    }
    daysToSave.push({ date: ds, details: details, isFinalized: !!finalize });
  }

  apiCall('POST', '/calendar/month/save', { month: m, year: y, days: daysToSave, isFinalized: !!finalize })
    .then(function(r){
      clearCalDraftFromSession(m, y);
      dbToast(finalize ? 'Month finalized in DB' : 'Drafts saved in DB', 'success', daysToSave.length + ' days updated');
      loadCalendar();
    })
    .catch(function(err){
      dbToast('Error: ' + (err && err.message ? err.message : 'Error saving month'), 'error');
    });
}

// DAY MODAL
function openDayModal(dateStr){
  var doc=calendarData[dateStr];
  var parts = String(dateStr).split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var dows=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var mns=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('dm-title').textContent=dows[d.getDay()]+', '+d.getDate()+' '+mns[d.getMonth()]+' '+d.getFullYear();
  document.getElementById('dm-sub').textContent=dateStr;
  document.getElementById('dm-date').value=dateStr;

  // Extract data — handle both DB format (details[]) and local format (top-level dayType)
  var dt='working', isWork=(d.getDay()!==0), timStart='08:30', timEnd='16:30', notes='', ayrs=[];
  if(doc){
    if(doc._local || doc.dayType){
      // Local auto-fill format
      dt=doc.dayType||'working';
      isWork=doc.isWorkingDay!==undefined?doc.isWorkingDay:(dt!=='leave');
      if(doc.timing){ timStart=doc.timing.start||'08:30'; timEnd=doc.timing.end||'16:30'; }
      notes=(doc.details&&doc.details[0]&&doc.details[0].comments)||'';
    } else if(doc.details && doc.details.length>0){
      // DB format
      var det=doc.details[0];
      dt=det.dayType||'working';
      isWork=(dt==='working'||dt==='exam'||dt==='half-day');
      if(det.timing){ timStart=det.timing.start||'08:30'; timEnd=det.timing.end||'16:30'; }
      notes=det.comments||'';
      // Extract affected years from details
      if(doc.details.length<4){
        ayrs=doc.details.map(function(dd){ return dd.year; });
      }
    }
  } else {
    if(d.getDay()===0){ dt='leave'; isWork=false; }
  }

  _dmWorking=isWork;
  updateDmToggle(_dmWorking);
  selDayType(dt,true);
  document.getElementById('dm-start').value=timStart;
  document.getElementById('dm-end').value=timEnd;
  document.getElementById('dm-notes').value=notes;
  document.querySelectorAll('.dm-yr-cb').forEach(function(cb){ cb.checked=ayrs.includes(cb.value); cb.closest('label').classList.toggle('checked',cb.checked); });
  var allYrCb=document.getElementById('dm-year-all');
  allYrCb.checked=(ayrs.length===0); document.getElementById('dm-yr-all').classList.toggle('checked',ayrs.length===0);
  openModal('day-modal-bg');
}
function updateDmToggle(val){ var t=document.getElementById('dm-toggle'); t.classList.toggle('on',val); document.getElementById('dm-toggle-label').textContent=val?'Yes':'No'; }
function toggleDmWorking(){ _dmWorking=!_dmWorking; updateDmToggle(_dmWorking); }
function selDayType(type,silent){
  _dmDayType=type;
  ['working','leave','exam','half-day'].forEach(function(t){ var el=document.getElementById('dt-'+t); if(el) el.classList.remove('sel'); });
  var el=document.getElementById('dt-'+type); if(el) el.classList.add('sel');
  var warn=document.getElementById('dm-exam-warn'); if(warn) warn.style.display=(type==='exam')?'':'none';
}
function toggleAllYrs(cb){
  document.getElementById('dm-yr-all').classList.toggle('checked',cb.checked);
  if(cb.checked) document.querySelectorAll('.dm-yr-cb').forEach(function(c){ c.checked=false; c.closest('label').classList.remove('checked'); });
}
function saveDayModal(){
  var dateStr=document.getElementById('dm-date').value,notes=document.getElementById('dm-notes').value.trim();
  var timing={start:document.getElementById('dm-start').value,end:document.getElementById('dm-end').value};
  var yrs=[]; if(!document.getElementById('dm-year-all').checked){ document.querySelectorAll('.dm-yr-cb').forEach(function(cb){ if(cb.checked) yrs.push(cb.value); }); }
  if(yrs.length===0) yrs=['I','II','III','IV'];
  var details=yrs.map(function(y){return {year:y,dayType:_dmDayType,comments:notes,timing:timing};});
  var isWorking=(_dmDayType==='working'||_dmDayType==='exam'||_dmDayType==='half-day');
  // Update local calendarData immediately (overwrites auto-gen)
  calendarData[dateStr]={date:dateStr,dayType:_dmDayType,isWorkingDay:isWorking,details:details,timing:timing,_local:true};
  
  var m=parseInt(document.getElementById('cal-month-sel').value),y=parseInt(document.getElementById('cal-year-inp').value);
  // Persist encrypted draft to sessionStorage
  saveCalDraftToSession(m, y);

  // Re-render calendar
  renderCalGrid(calendarData,m,y,'cal-grid',false);
  updateCalStats(m,y);
  var badge = document.getElementById('cal-finalized-badge');
  if (badge) { badge.textContent = '📝 Local Draft'; badge.style.color = '#b45309'; }
  closeModal('day-modal-bg');
  showToast('Day updated in session draft. Click Save Draft or Save & Finalize to push to DB.','success');
}

// EXAMS
function examSubTab(tab){
  document.getElementById('est-dates-panel').style.display=tab==='dates'?'':'none';
  document.getElementById('est-att-panel').style.display=tab==='attendance'?'':'none';
  document.getElementById('est-dates-btn').classList.toggle('act',tab==='dates');
  document.getElementById('est-att-btn').classList.toggle('act',tab==='attendance');
  if(tab==='dates') loadExams();
  if(tab==='attendance'){ populateExamSel(); populateDeptCheckboxes(); }
}
function loadDepts(){
  apiCall('GET','/depts').then(function(d){ 
    deptsData=Array.isArray(d)?d:[]; 
    populateDeptSelectsAll(); 
  }).catch(function(){ dbToast('Failed to load depts','error');});
}
function populateDeptSelectsAll(){
  var sel=document.getElementById('em-dept'); if(!sel) return;
  sel.innerHTML='<option value="">All Departments</option>';
  deptsData.forEach(function(dp){ sel.innerHTML+='<option value="'+dp._id+'">'+dp.name+'</option>'; });
}
function populateExamFilterAcYears(){
  var efAcSel = document.getElementById('ef-acyear');
  if (!efAcSel || efAcSel.tagName !== 'SELECT') return;
  var curVal = efAcSel.value;
  var html = '<option value="">All Academic Years</option>';
  (yearsData || []).forEach(function(y){
    html += '<option value="' + y.academicYear + '"' + (y.isCurrent ? ' data-current="true"' : '') + '>' + y.academicYear + (y.isCurrent ? ' (Current)' : '') + '</option>';
  });
  efAcSel.innerHTML = html;
  if (curVal) efAcSel.value = curVal;
}

function loadExams(){
  var type=document.getElementById('ef-type').value, 
  yr=document.getElementById('ef-year').value;
  var status=document.getElementById('ef-status').value, 
  acyr=document.getElementById('ef-acyear') ? document.getElementById('ef-acyear').value.trim() : '';
  var q='/exams?'; if(type) q+='examType='+encodeURIComponent(type)+'&'; if(yr) q+='semester='+encodeURIComponent(yr)+'&';
  if(status) q+='status='+encodeURIComponent(status)+'&'; if(acyr) q+='academicYear='+encodeURIComponent(acyr)+'&';
  document.getElementById('exams-tbody').innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--tdi);padding:20px;">Loading…</td></tr>';
  apiCall('GET',q).then(function(data){ examsData=Array.isArray(data)?data:[]; renderExamsTable(examsData); }).catch(function(){ document.getElementById('exams-tbody').innerHTML='<tr><td colspan="10" style="text-align:center;color:#dc2626;padding:20px;">Failed to load</td></tr>'; });
}
var typePills={'Internal 1':'<span class="bge bgb">Int 1</span>','Internal 2':'<span class="bge bgp">Int 2</span>',Practicals:'<span class="bge bga">Labs</span>',Semester:'<span class="bge bgr">Sem</span>'};
var statusPills={upcoming:'<span class="bge bgb">Upcoming</span>',ongoing:'<span class="bge bgg">Ongoing</span>',completed:'<span class="bge bggy">Done</span>',cancelled:'<span class="bge bgr">Cancelled</span>'};
function renderExamsTable(exams){
  if(!exams.length){ document.getElementById('exams-tbody').innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--tdi);padding:24px;">No exams. Click <strong>+ Add Exam</strong>.</td></tr>'; return; }
  var html='';
  exams.forEach(function(ex,i){
    var rng=examDates(ex);
    html+='<tr><td class="b">'+(i+1)+'</td><td class="b">'+ex.title+'</td><td>'+(typePills[ex.examType]||ex.examType)+'</td><td><span class="bge bgg">'+ex.semester+'</span></td><td>'+(ex.deptName||'<em style="color:var(--tdi)">All</em>')+'</td><td>'+fmtDate(rng.start)+'</td><td>'+fmtDate(rng.end)+'</td><td style="white-space:nowrap;">'+(ex.timing?ex.timing.start+'–'+ex.timing.end:'—')+'</td><td>'+(statusPills[ex.status]||ex.status)+'</td>'
      +'<td style="white-space:nowrap;">'
      +'<button class="btn-out btn-xs" onclick="openExamModal(\''+ex.ExamTrackId+'\')" style="margin-right:4px;">✏️</button>'
      +'<button style="background:rgba(59,130,246,.08);color:#2563eb;border:1px solid rgba(59,130,246,.2);border-radius:9px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer;font-family:\'Poppins\',sans-serif;" onclick="quickViewAtt(\''+ex.ExamTrackId+'\',\''+ex.title+'\')">👁️</button>'
      +'</td></tr>';
  });
  document.getElementById('exams-tbody').innerHTML=html;
}
function populateExamAcYearsAndBatches(selectedAcYear, selectedBatch, selectedSem){
  var acSel = document.getElementById('em-acyear');
  if(!acSel) return;
  var promise = (yearsData && yearsData.length > 0) ? Promise.resolve(yearsData) : apiCall('GET', '/year');
  promise.then(function(data){
    yearsData = Array.isArray(data) ? data : [];
    populateExamFilterAcYears();

    var html = '<option value="">— Select Academic Year —</option>';
    yearsData.forEach(function(y){
      html += '<option value="' + y.academicYear + '"' + (y.isCurrent ? ' data-current="true"' : '') + '>' + y.academicYear + (y.isCurrent ? ' (Current)' : '') + '</option>';
    });
    acSel.innerHTML = html;

    var targetAcYear = selectedAcYear;
    if (!targetAcYear) {
      var cur = yearsData.find(function(y){ return y.isCurrent; });
      if (cur) targetAcYear = cur.academicYear;
    }
    if (targetAcYear) acSel.value = targetAcYear;

    populateExamBatches(selectedBatch, selectedSem);
  }).catch(function(){});
}

function populateExamBatches(selectedBatch, selectedSem){
  var bSel = document.getElementById('em-batch');
  if(!bSel) return;
  var acVal = document.getElementById('em-acyear').value;
  var yObj = (yearsData || []).find(function(y){ return y.academicYear === acVal; });
  var batches = (yObj && Array.isArray(yObj.batches)) ? yObj.batches : [];
  var html = '<option value="">— Select Batch —</option>';
  batches.forEach(function(b){
    html += '<option value="' + b.batch + '" data-year="' + (b.currentYear||'') + '" data-sem="' + (b.currentSem||'') + '">' + b.batch + ' (Year ' + b.currentYear + ' • Sem ' + b.currentSem + ')</option>';
  });
  bSel.innerHTML = html;
  if (selectedBatch) {
    bSel.value = selectedBatch;
  }
  onEmBatchChange(selectedSem);
}

function onEmAcYearChange(){
  populateExamBatches(null, null);
}

function updateSemesterDropdownForYear(yearLevel, selectedSem){
  var semSel = document.getElementById('em-semester');
  if(!semSel) return;
  var semMap = {
    'I': ['I', 'II'],
    'II': ['III', 'IV'],
    'III': ['V', 'VI'],
    'IV': ['VII', 'VIII'],
    'All': ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
  };
  var validSems = semMap[yearLevel] || ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  var html = '<option value="">— Select Semester —</option>';
  validSems.forEach(function(s){
    html += '<option value="' + s + '">' + 'Semester ' + s + '</option>';
  });
  semSel.innerHTML = html;
  if(selectedSem && validSems.includes(selectedSem)){
    semSel.value = selectedSem;
  } else if(validSems.length > 0 && yearLevel !== 'All'){
    semSel.value = validSems[0];
  }
}

function onEmBatchChange(presetSem){
  var bSel = document.getElementById('em-batch');
  var opt = bSel ? bSel.options[bSel.selectedIndex] : null;
  if(opt && opt.value){
    var bYear = opt.getAttribute('data-year');
    var bSem = opt.getAttribute('data-sem');
    if(bYear && document.getElementById('em-year')) {
      document.getElementById('em-year').value = bYear;
      updateSemesterDropdownForYear(bYear, presetSem || bSem);
    }
  } else {
    var curYr = document.getElementById('em-year') ? document.getElementById('em-year').value : '';
    updateSemesterDropdownForYear(curYr, presetSem);
  }
}

function onEmYearChange(){
  var yr = document.getElementById('em-year').value;
  var bSel = document.getElementById('em-batch');
  var acVal = document.getElementById('em-acyear') ? document.getElementById('em-acyear').value : '';
  var yObj = (yearsData || []).find(function(y){ return y.academicYear === acVal; });
  if (yObj && yObj.batches && yr && yr !== 'All') {
    var matchBatch = yObj.batches.find(function(b){ return b.currentYear === yr; });
    if (matchBatch && bSel && (!bSel.value || (bSel.options[bSel.selectedIndex] && bSel.options[bSel.selectedIndex].getAttribute('data-year') !== yr))) {
      bSel.value = matchBatch.batch;
    }
  }
  updateSemesterDropdownForYear(yr, null);
}

function onEmSemChange(){
  var sem = document.getElementById('em-semester').value;
  var yrSel = document.getElementById('em-year');
  if(!yrSel || !sem) return;
  if(['I','II'].includes(sem)) yrSel.value = 'I';
  else if(['III','IV'].includes(sem)) yrSel.value = 'II';
  else if(['V','VI'].includes(sem)) yrSel.value = 'III';
  else if(['VII','VIII'].includes(sem)) yrSel.value = 'IV';
}

function openExamModal(examId){
  document.getElementById('exam-modal-title').textContent=examId?'Edit Exam':'Add Exam';
  document.getElementById('em-id').value=examId||'';
  document.getElementById('em-delete-btn').style.display=examId?'':'none';
  ['em-title','em-notes'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('em-type').value=''; document.getElementById('em-year').value=''; document.getElementById('em-semester').value='';
  document.getElementById('em-dept').value=''; document.getElementById('em-t-start').value='09:00';
  document.getElementById('em-t-end').value='16:00'; document.getElementById('em-status').value='upcoming';
  document.getElementById('em-start').value=''; document.getElementById('em-end').value='';
  if(examId){
    var ex=examsData.find(function(e){return e.ExamTrackId===examId;});
    if(ex){
      var rng=examDates(ex);
      document.getElementById('em-title').value=ex.title||'';
      document.getElementById('em-type').value=ex.examType||'';
      document.getElementById('em-year').value=ex.year||(['I','II'].includes(ex.semester)?'I':['III','IV'].includes(ex.semester)?'II':['V','VI'].includes(ex.semester)?'III':'IV');
      document.getElementById('em-semester').value=ex.semester||'';
      var deptId=''; if(ex.deptName){ var mdept=deptsData.find(function(d){return d.name===ex.deptName;}); if(mdept) deptId=mdept._id; }
      document.getElementById('em-dept').value=deptId;
      document.getElementById('em-start').value=rng.start;
      document.getElementById('em-end').value=rng.end;
      document.getElementById('em-t-start').value=(ex.timing&&ex.timing.start)||'09:00';
      document.getElementById('em-t-end').value=(ex.timing&&ex.timing.end)||'16:00';
      document.getElementById('em-status').value=ex.status||'upcoming';
      document.getElementById('em-notes').value=ex.notes||'';
      populateExamAcYearsAndBatches(ex.academicYear, ex.batch, ex.semester);
      openModal('exam-modal-bg');
      return;
    }
  }
  populateExamAcYearsAndBatches(null, null, null);
  openModal('exam-modal-bg');
}

function saveExam(finalize){
  var id=document.getElementById('em-id').value, title=document.getElementById('em-title').value.trim();
  var type=document.getElementById('em-type').value, semester=document.getElementById('em-semester').value;
  var year=document.getElementById('em-year').value || (['I','II'].includes(semester)?'I':['III','IV'].includes(semester)?'II':['V','VI'].includes(semester)?'III':'IV');
  var acYear=document.getElementById('em-acyear').value.trim();
  var batch=document.getElementById('em-batch').value.trim();
  var start=document.getElementById('em-start').value, end=document.getElementById('em-end').value;

  if(!title){showToast('Title is required','warn');return;} 
  if(!type){showToast('Exam type required','warn');return;}
  if(!acYear){showToast('Academic Year is required','warn');return;}
  if(!batch){showToast('Batch is required','warn');return;}
  if(!semester){showToast('Semester is required','warn');return;}
  if(!start||!end){showToast('Start and end dates required','warn');return;} 
  if(start>end){showToast('Start must be before end','warn');return;}

  dbToast('Saving exam & syncing calendar…','saving');
  var deptEl=document.getElementById('em-dept'), deptId=deptEl.value||null, deptName=deptId?deptEl.options[deptEl.selectedIndex].text:'';
  var Dates=[], cur=new Date(start+'T00:00:00'), endD=new Date(end+'T00:00:00');
  while(cur<=endD){ Dates.push(cur.getFullYear()+'-'+pad2(cur.getMonth()+1)+'-'+pad2(cur.getDate())); cur.setDate(cur.getDate()+1); }
  
  apiCall(id?'PUT':'POST',id?'/exams/'+id:'/exams',{
    title,
    examType:type,
    year,
    semester,
    academicYear:acYear,
    batch:batch,
    deptId,
    deptName,
    Dates,
    timing:{start:document.getElementById('em-t-start').value,end:document.getElementById('em-t-end').value},
    status:document.getElementById('em-status').value,
    notes:document.getElementById('em-notes').value.trim(),
    isFinalized:!!finalize
  })
  .then(function(r){
    dbToast('Exam saved & calendar updated','success'); 
    closeModal('exam-modal-bg'); 
    loadExams(); 
    if (Dates && Dates.length > 0) {
      var p = Dates[0].split('-');
      var emMonth = parseInt(p[1]), emYear = parseInt(p[0]);
      document.getElementById('cal-month-sel').value = emMonth;
      document.getElementById('cal-year-inp').value = emYear;
      clearCalDraftFromSession(emMonth, emYear);
    }
    loadCalendar(); 
  }).catch(function(err){ dbToast('Error: '+(err&&err.message?err.message:'Server error'),'error'); });
}

function deleteExam(){
  if(!confirm('Delete this exam? Calendar exam entries will also be removed.')) return;
  var id=document.getElementById('em-id').value;
  dbToast('Deleting exam & syncing calendar…','saving');
  apiCall('DELETE','/exams/'+id).then(function(r){ 
    dbToast('Exam deleted & calendar synced','success'); 
    closeModal('exam-modal-bg'); 
    loadExams(); 
    loadCalendar(); 
  }).catch(function(err){dbToast('Error: '+(err&&err.message?err.message:'Server error'),'error');});
}

// EXAM ATTENDANCE
function populateExamSel(){
  apiCall('GET','/exams/active').then(function(data){
    var exams=Array.isArray(data)?data:[], sel=document.getElementById('ea-exam-sel');
    sel.innerHTML='<option value="">— Select Exam —</option>';
    exams.forEach(function(ex){ var rng=examDates(ex); sel.innerHTML+='<option value="'+ex.ExamTrackId+'">'+ex.title+' ('+fmtDate(rng.start)+' – '+fmtDate(rng.end)+')</option>'; });
  }).catch(function(){});
}
function onExamSelChange(){
  var examId=document.getElementById('ea-exam-sel').value;
  document.getElementById('ea-date-sel').innerHTML='<option value="">— Select Date —</option>';
  if(!examId) return;
  var ex=examsData.find(function(e){return e.ExamTrackId===examId;});
  if(ex){ populateDateDrop(ex); } else { apiCall('GET','/exams/'+examId).then(function(r){ populateDateDrop(r); }).catch(function(){}); }
  loadHallSummary();
}
function populateDateDrop(ex){
  var sel=document.getElementById('ea-date-sel');
  sel.innerHTML='<option value="">— Select Date —</option>';
  var rng=examDates(ex);
  if(!rng.start||!rng.end) return;
  var cur=new Date(rng.start+'T00:00:00'), end=new Date(rng.end+'T00:00:00');
  while(cur<=end){ var ds=cur.getFullYear()+'-'+pad2(cur.getMonth()+1)+'-'+pad2(cur.getDate()); var dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][cur.getDay()]; sel.innerHTML+='<option value="'+ds+'">'+dow+' '+fmtDate(ds)+(ds===todayStr()?' ← Today':'')+'</option>'; cur.setDate(cur.getDate()+1); }
  if(rng.start<=todayStr()&&todayStr()<=rng.end) sel.value=todayStr();
}
function onExamDateChange(){ loadHallSummary(); }
function populateDeptCheckboxes(){
  if(!deptsData.length){ apiCall('GET','/depts').then(function(d){ deptsData=Array.isArray(d)?d:[]; buildDeptCbs(); }).catch(function(){}); return; }
  buildDeptCbs();
}
function buildDeptCbs(){
  var wrap=document.getElementById('ea-dept-wrap'); if(!wrap) return;
  if(!deptsData.length){ wrap.innerHTML='<div style="color:var(--tdi);font-size:11.5px;">No departments found.</div>'; return; }
  wrap.innerHTML='';
  deptsData.forEach(function(dp){ var lbl=document.createElement('label'); lbl.className='dept-cb-wrap'; lbl.dataset.name=dp.name; var cb=document.createElement('input'); cb.type='checkbox'; cb.value=dp._id; cb.addEventListener('change',function(){ lbl.classList.toggle('checked',cb.checked); }); lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' '+dp.name)); wrap.appendChild(lbl); });
}
function getSelectedDepts(){ var r=[]; document.querySelectorAll('#ea-dept-wrap .dept-cb-wrap.checked').forEach(function(l){ r.push(l.dataset.name); }); return r; }
var _srchTimer=null;
function searchStudentByRegno(q){
  var dd=document.getElementById('ea-search-dd'); if(q.length<3){dd.classList.remove('open');return;}
  clearTimeout(_srchTimer); _srchTimer=setTimeout(function(){
    var depts=getSelectedDepts().join(','), yr=document.getElementById('ea-year-filter').value;
    var url='/students/exam-search?q='+encodeURIComponent(q); if(depts) url+='&depts='+encodeURIComponent(depts); if(yr) url+='&year='+encodeURIComponent(yr);
    apiCall('GET',url).then(function(s){ renderSrchDd(Array.isArray(s)?s:[]); }).catch(function(){dd.classList.remove('open');});
  },260);
}
function renderSrchDd(students){
  var dd=document.getElementById('ea-search-dd');
  if(!students.length){ dd.innerHTML='<div class="srch-item" style="color:var(--tdi);cursor:default;">No matching students.</div>'; dd.classList.add('open'); return; }
  dd.innerHTML='';
  students.forEach(function(s){ var already=eaStudentList.some(function(r){return r.regNo===s.regNo;}); var div=document.createElement('div'); div.className='srch-item'; div.innerHTML='<div class="srch-name">'+(s.name||'Unknown')+(already?' <span style="color:var(--gK);font-size:10px;">✓ Added</span>':'')+'</div><div class="srch-meta">Reg: <strong>'+s.regNo+'</strong> · '+s.deptName+' · Year '+s.year+'</div>'; if(!already) div.onclick=function(){ addStudent(s); document.getElementById('ea-regno-inp').value=''; dd.classList.remove('open'); }; dd.appendChild(div); });
  dd.classList.add('open');
}
document.addEventListener('click',function(e){ if(!e.target.closest('#ea-search-dd')&&!e.target.matches('#ea-regno-inp')) document.getElementById('ea-search-dd').classList.remove('open'); });
function addStudent(s){ if(eaStudentList.some(function(r){return r.regNo===s.regNo;})){showToast('Already added','warn');return;} eaStudentList.push({_id:s._id||null,trackId:s.trackId||'',regNo:s.regNo,name:s.name||'',deptName:s.deptName||'',year:s.year||'',status:'present'}); renderStudentList(); }
function renderStudentList(){
  var cont=document.getElementById('ea-student-list'), pill=document.getElementById('ea-count-pill'), sub=document.getElementById('ea-submit-btn');
  if(!eaStudentList.length){ cont.innerHTML='<div style="text-align:center;color:var(--tdi);font-size:11.5px;padding:30px 0;">No students added yet.</div>'; pill.textContent='0 students'; document.getElementById('ea-present-count').textContent='0'; document.getElementById('ea-absent-count').textContent='0'; sub.disabled=true; sub.style.opacity='.5'; sub.style.cursor='not-allowed'; return; }
  var present=0,absent=0,html='';
  eaStudentList.forEach(function(s,i){ if(s.status==='present')present++;else absent++; html+='<div class="ea-row"><div style="font-size:11px;color:var(--tdi);width:18px;font-weight:700;">'+(i+1)+'</div><div class="ea-info"><div class="ea-name">'+s.name+'</div><div class="ea-meta">'+s.regNo+' · '+s.deptName+' · Year '+s.year+'</div></div><button class="ea-status-btn '+(s.status==='present'?'present':'absent')+'" onclick="toggleEaStatus('+i+')">'+(s.status==='present'?'✓ Present':'✗ Absent')+'</button><button class="ea-rm" onclick="removeEaStudent('+i+')">✕</button></div>'; });
  cont.innerHTML=html; pill.textContent=eaStudentList.length+' student'+(eaStudentList.length>1?'s':'');
  document.getElementById('ea-present-count').textContent=present; document.getElementById('ea-absent-count').textContent=absent;
  sub.disabled=false; sub.style.opacity='1'; sub.style.cursor='pointer';
}
function toggleEaStatus(i){ eaStudentList[i].status=eaStudentList[i].status==='present'?'absent':'present'; renderStudentList(); }
function removeEaStudent(i){ eaStudentList.splice(i,1); renderStudentList(); }
function clearExamList(){ eaStudentList=[]; renderStudentList(); }
function submitExamAttendance(){
  var examId=document.getElementById('ea-exam-sel').value, date=document.getElementById('ea-date-sel').value, hallNo=document.getElementById('ea-hall-inp').value.trim();
  if(!examId){showToast('Select an exam','warn');return;} if(!date){showToast('Select a date','warn');return;} if(!hallNo){showToast('Enter your hall number','warn');return;} if(!eaStudentList.length){showToast('Add at least one student','warn');return;}
  dbToast('Submitting…','saving');
  apiCall('POST','/exam-attendance',{examTrackId:examId,date,hallNo,records:eaStudentList.map(function(s){return{studentTrackId:s.trackId,regNo:s.regNo,name:s.name,deptName:s.deptName,year:s.year,status:s.status};})})
    .then(function(r){ dbToast('Submitted — Hall '+hallNo,'success',eaStudentList.filter(function(s){return s.status==='present';}).length+' present'); clearExamList(); document.getElementById('ea-hall-inp').value=''; loadHallSummary(); }).catch(function(err){dbToast('Error: '+(err&&err.message?err.message:'Server error'),'error');});
}
function loadHallSummary(){
  var examId=document.getElementById('ea-exam-sel').value, date=document.getElementById('ea-date-sel').value||todayStr();
  if(!examId) return;
  apiCall('GET','/exam-attendance/halls-today?examTrackId='+examId+'&date='+date).then(function(halls){ renderHallSummary(Array.isArray(halls)?halls:[]); }).catch(function(){});
}
function renderHallSummary(halls){
  var tbody=document.getElementById('hall-summary-tbody');
  if(!halls.length){tbody.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--tdi);padding:16px;font-size:12px;">No submissions yet.</td></tr>';return;}
  var html='';
  halls.forEach(function(h){ var t=h.markedAt?new Date(h.markedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—'; html+='<tr><td class="b">'+h.hallNo+'</td><td class="b">'+h.teacherName+'</td><td>'+(h.examTitle||'—')+'</td><td>'+fmtDate(h.date)+'</td><td><strong style="color:var(--gK);">'+h.totalPresent+'</strong></td><td><strong style="color:#dc2626;">'+h.totalAbsent+'</strong></td><td>'+t+'</td><td><button class="btn-out btn-xs" onclick="viewHallAtt(\''+h._id+'\')">👁️</button></td></tr>'; });
  tbody.innerHTML=html;
}
function viewHallAtt(id){
  apiCall('GET','/exam-attendance/'+id).then(function(r){ if(!r){showToast('Failed','warn');return;} document.getElementById('vam-title').textContent='Hall '+r.hallNo; document.getElementById('vam-sub').textContent=r.examTitle+' — '+fmtDate(r.date); document.getElementById('vam-meta').innerHTML='<span>👩‍🏫 <strong>'+r.teacherName+'</strong></span><span>🏛️ '+r.hallNo+'</span><span>📅 '+fmtDate(r.date)+'</span>'; var tb=document.getElementById('vam-tbody'); tb.innerHTML=''; r.records.forEach(function(rec,i){ tb.innerHTML+='<tr><td class="b">'+(i+1)+'</td><td class="b">'+rec.regNo+'</td><td>'+rec.name+'</td><td>'+rec.deptName+'</td><td>'+rec.year+'</td><td>'+(rec.status==='present'?'<span class="bge bgg">Present</span>':'<span class="bge bgr">Absent</span>')+'</td></tr>'; }); document.getElementById('vam-present-total').textContent='✓ Present: '+r.totalPresent; document.getElementById('vam-absent-total').textContent='✗ Absent: '+r.totalAbsent; openModal('view-att-bg'); }).catch(function(){showToast('Server error','warn');});
}
function quickViewAtt(examId,title){ examSubTab('attendance'); setTimeout(function(){ document.getElementById('ea-exam-sel').value=examId; onExamSelChange(); },100); }

// MANAGE ADMINS (SETTINGS)
var _teachersForAdminList = [];

function loadTeachersForAdminModal(){
  var sel = document.getElementById('am-teacher-select');
  if(!sel) return;
  sel.innerHTML = '<option value="">-- Loading Teachers… --</option>';
  apiCall('GET', '/teachers').then(function(data){
    _teachersForAdminList = Array.isArray(data) ? data : [];
    var optHtml = '<option value="">-- Choose Teacher to Grant Access --</option>';
    _teachersForAdminList.forEach(function(t){
      optHtml += '<option value="' + t._id + '" data-name="' + (t.name||'') + '" data-user="' + (t.username||'') + '" data-email="' + (t.email||'') + '" data-dept="' + (t.dept||t.department||'') + '">' + (t.name||'Teacher') + ' (' + (t.dept||t.department||'Faculty') + ') - @' + (t.username||'') + '</option>';
    });
    sel.innerHTML = optHtml;
  }).catch(function(){
    sel.innerHTML = '<option value="">-- Could not load teachers --</option>';
  });
}

function onAdminTeacherSelect(){
  var sel = document.getElementById('am-teacher-select');
  var opt = sel ? sel.options[sel.selectedIndex] : null;
  var prevCard = document.getElementById('am-teacher-preview');
  if(opt && opt.value){
    document.getElementById('am-teacher-id').value = opt.value;
    document.getElementById('am-prev-name').textContent = opt.getAttribute('data-name') || '';
    document.getElementById('am-prev-user').textContent = '@' + (opt.getAttribute('data-user') || '');
    document.getElementById('am-prev-dept').textContent = opt.getAttribute('data-dept') || 'Faculty';
    document.getElementById('am-prev-email').textContent = opt.getAttribute('data-email') || '—';
    if(prevCard) prevCard.style.display = 'block';
  } else {
    document.getElementById('am-teacher-id').value = '';
    if(prevCard) prevCard.style.display = 'none';
  }
}

function loadManageAdmins(){
  document.getElementById('manage-admins-list').innerHTML='<div style="text-align:center;padding:20px;color:var(--tdi);font-size:12px;">Loading…</div>';
  apiCall('GET','/manage-admins').then(function(data){
    var admins=Array.isArray(data)?data:[];
    if(!admins.length){ document.getElementById('manage-admins-list').innerHTML='<div style="text-align:center;padding:24px;color:var(--tdi);font-size:12px;">No manage portal admins added yet.</div>'; return; }
    var html='<div style="display:flex;flex-direction:column;gap:10px;">';
    admins.forEach(function(a){
      var permsHtml=(a.permissions||[]).map(function(p){ return '<span class="perm-chip">'+p+'</span>'; }).join('');
      var roleBadge = a.type === 'teacher' ? '<span class="bge" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;">👨‍🏫 Faculty (' + (a.department || 'Staff') + ')</span>' : '<span class="bge bgp">👤 Custom Admin</span>';
      var statusPill=a.active!==false?'<span class="bge bgg">Active</span>':'<span class="bge bgr">Inactive</span>';
      html+='<div class="admin-card">'
        +'<div class="admin-av" style="' + (a.type==='teacher'?'background:linear-gradient(135deg,#3b82f6,#1d4ed8);':'') + '">'+(a.name[0]||'A').toUpperCase()+'</div>'
        +'<div class="admin-info">'
          +'<div class="admin-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'+a.name+' '+roleBadge+' '+statusPill+'</div>'
          +'<div class="admin-user">@'+a.username+(a.email?' · '+a.email:'')+'</div>'
          +'<div style="margin-top:4px;">'+permsHtml+'</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;">'
          +'<button class="btn-out btn-xs" style="color:#dc2626;border-color:#fca5a5;" onclick="deleteManageAdminDirect(\''+a._id+'\',\''+a.name.replace(/'/g,"\\'")+'\')">🗑 Revoke</button>'
          +'<div style="font-size:9.5px;color:var(--tdi);">'+(a.addedBy ? 'Added by ' + a.addedBy : '')+'</div>'
        +'</div>'
        +'</div>';
    });
    html+='</div>';
    document.getElementById('manage-admins-list').innerHTML=html;
  }).catch(function(){ document.getElementById('manage-admins-list').innerHTML='<div style="text-align:center;padding:20px;color:#dc2626;font-size:12px;">Failed to load</div>'; });
}

function openAdminModal(){
  document.getElementById('am-title').textContent='Grant Manage Access';
  document.getElementById('am-teacher-id').value='';
  var prevCard = document.getElementById('am-teacher-preview');
  if(prevCard) prevCard.style.display = 'none';
  document.querySelectorAll('#am-perms-wrap input').forEach(function(cb){ cb.checked=true; cb.closest('label').classList.add('checked'); });
  loadTeachersForAdminModal();
  openModal('admin-modal-bg');
}

function saveManageAdmin(){
  var teacherId=document.getElementById('am-teacher-id').value;
  if(!teacherId){
    showToast('Please select a faculty member from the list','warn');
    return;
  }
  var perms=[]; 
  document.querySelectorAll('#am-perms-wrap input').forEach(function(cb){ if(cb.checked) perms.push(cb.value); });

  dbToast('Granting access…','saving');
  apiCall('POST','/manage-admins',{ teacherId: teacherId, permissions: perms })
    .then(function(r){ 
      dbToast('Manage access granted','success'); 
      closeModal('admin-modal-bg'); 
      loadManageAdmins(); 
    })
    .catch(function(err){
      dbToast('Error: '+(err&&err.message?err.message:'Server error'),'error');
    });
}

function deleteManageAdmin(){
  var id=document.getElementById('am-id').value;
  deleteManageAdminDirect(id, 'this admin');
}

function deleteManageAdminDirect(id, name){
  if(!confirm('Remove / revoke manage portal access for ' + name + '?')) return;
  dbToast('Removing…','saving');
  apiCall('DELETE','/manage-admins/'+id).then(function(r){ 
    dbToast('Access removed','success'); 
    closeModal('admin-modal-bg'); 
    loadManageAdmins(); 
  }).catch(function(err){
    dbToast('Error: '+(err&&err.message?err.message:'Server error'),'error');
  });
}

// init perm checkboxes toggle behavior
document.querySelectorAll('#am-perms-wrap .dept-cb-wrap').forEach(function(lbl){
  var cb=lbl.querySelector('input'); if(cb) cb.addEventListener('change',function(){ lbl.classList.toggle('checked',cb.checked); });
});

// YEARS MANAGEMENT
var yearsData = [];
var _ymCurrent = false;

// Year / Semester helpers
var ROMAN_ORDER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
var YEAR_SEM_MAP = { I: ['I', 'II'], II: ['III', 'IV'], III: ['V', 'VI'], IV: ['VII', 'VIII'] };
var SEM_TO_YEAR = {};
Object.keys(YEAR_SEM_MAP).forEach(function(yr) { YEAR_SEM_MAP[yr].forEach(function(s) { SEM_TO_YEAR[s] = yr; }); });
var YEAR_LEVEL_OFFSET = { I: 0, II: 1, III: 2, IV: 3 };
var YEAR_LEVEL_DEFAULT_SEM = { I: 'I', II: 'III', III: 'V', IV: 'VII' };

function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

function nextSemester(sem) {
  var idx = ROMAN_ORDER.indexOf(sem);
  if (idx === -1 || idx === ROMAN_ORDER.length - 1) return null;
  return ROMAN_ORDER[idx + 1];
}

function suggestNextAcademicYear() {
  var maxStart = 0;
  yearsData.forEach(function(y) {
    var m = (y.academicYear || '').match(/^(\d{4})-(\d{4})$/);
    if (m) { var s = parseInt(m[1], 10); if (s > maxStart) maxStart = s; }
  });
  var base = maxStart || new Date().getFullYear();
  var nextStart = maxStart ? maxStart + 1 : base;
  return nextStart + '-' + (nextStart + 1);
}

function computeBatchForLevel(acadYearStr, level) {
  var m = (acadYearStr || '').match(/^(\d{4})-(\d{4})$/);
  if (!m) return null;
  var acadStart = parseInt(m[1], 10);
  var offset = YEAR_LEVEL_OFFSET[level] || 0;
  var batchStart = acadStart - offset;
  var batchEnd = batchStart + 4;
  return {
    batch: batchStart + '-' + batchEnd,
    trackId: 'TR-BATCH-' + String(batchStart).slice(-2) + String(batchEnd).slice(-2),
    year: level,
    sem: YEAR_LEVEL_DEFAULT_SEM[level]
  };
}

function populateSemOptions(selectEl, yearLevel, presetSem) {
  var opts = YEAR_SEM_MAP[yearLevel] || ROMAN_ORDER;
  var html = '';
  if (!yearLevel) html += '<option value="">— Select Year first —</option>';
  opts.forEach(function(s) {
    html += '<option value="' + s + '"' + (presetSem === s ? ' selected' : '') + '>Semester ' + s + '</option>';
  });
  if (presetSem && opts.indexOf(presetSem) === -1) {
    html += '<option value="' + presetSem + '" selected>Semester ' + presetSem + '</option>';
  }
  selectEl.innerHTML = html;
  if (!presetSem && yearLevel) selectEl.value = opts[0];
}

// Load / Render
function loadYears() {
  apiCall('GET', '/year').then(function(data) {
    yearsData = Array.isArray(data) ? data : [];
    populateExamFilterAcYears();
    renderCurrentYear();
    renderYearsTable();
  }).catch(function(err) {
    console.error('Error loading academic years:', err);
    var cont = document.getElementById('current-year-display');
    if (cont) cont.innerHTML = '<div style="text-align:center;color:#dc2626;padding:20px;font-size:12px;">Failed to load academic years.</div>';
    var tbody = document.getElementById('years-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#dc2626;padding:24px;">Failed to load academic years.</td></tr>';
  });
}

function renderCurrentYear() {
  var cont = document.getElementById('current-year-display');
  if (!cont) return;
  var currentYear = yearsData.find(function(y) { return y.isCurrent; });
  if (!currentYear) {
    cont.innerHTML = '<div style="text-align:center;color:var(--tdi);padding:24px 16px;font-size:13px;">No active academic year set. Click <strong style="color:var(--gD);cursor:pointer;" onclick="openYearModal(null)">+ Add Academic Year</strong> to configure one.</div>';
    return;
  }
  
  var html = '<div style="background:var(--gLt);border:2px solid var(--gM);border-radius:12px;padding:16px;">';
  html += '<div style="font-size:20px;font-weight:800;color:var(--gD);margin-bottom:12px;">📚 ' + (currentYear.academicYear || '—') + '</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;">';
  (currentYear.batches || []).forEach(function(b) {
    var idx = ROMAN_ORDER.indexOf(b.currentSem);
    var pct = idx >= 0 ? Math.round(((idx + 1) / ROMAN_ORDER.length) * 100) : 0;
    html += '<div class="yr-batch-card">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html += '<div style="font-size:13px;font-weight:700;color:var(--td);">' + b.batch + '</div>';
    html += '<span class="yr-badge yr-badge-' + b.currentYear + '">Year ' + b.currentYear + '</span>';
    html += '</div>';
    html += '<div style="font-size:11px;color:var(--tmu);">Semester ' + b.currentSem + ' of VIII</div>';
    html += '<div class="yr-progress-track"><div class="yr-progress-fill" style="width:' + pct + '%;"></div></div>';
    html += '<button class="btn-out btn-xs" style="margin-top:10px;" onclick="openBatchModal(\'' + currentYear._id + '\',\'' + b.batchTrackId + '\',\'' + b.batch + '\',\'' + b.currentYear + '\',\'' + b.currentSem + '\')">✏️ Edit</button>';
    html += '</div>';
  });
  html += '</div></div>';
  cont.innerHTML = html;
}

function renderYearsTable() {
  var tbody = document.getElementById('years-tbody');
  if (!tbody) return;
  if (!yearsData.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--tdi);padding:24px;">No academic years configured. Click <strong>+ Add Academic Year</strong>.</td></tr>';
    return;
  }

  var sorted = yearsData.slice().sort(function(a, b) {
    var ac = a.isCurrent ? 1 : 0, bc = b.isCurrent ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return (b.academicYear || '').localeCompare(a.academicYear || '');
  });

  var html = '';
  sorted.forEach(function(y) {
    var batchPills = (y.batches || []).map(function(b) {
      return '<span class="yr-batch-pill">' + b.batch + '<span class="yr-badge yr-badge-' + b.currentYear + '" style="padding:1px 6px;">' + b.currentYear + '·' + b.currentSem + '</span></span>';
    }).join('');
    var currentBadge = y.isCurrent ? '<span class="bge bgg">🎯 Current</span>' : '<span class="bge bggy">—</span>';
    var createdAt = y.createdAt ? fmtDate(y.createdAt.split('T')[0]) : '—';
    html += '<tr class="' + (y.isCurrent ? 'yr-row-current' : '') + '"><td class="b">' + y.academicYear + '</td><td>' + batchPills + '</td><td>' + currentBadge + '</td><td>' + (y.createdBy || '—') + '</td><td>' + createdAt + '</td>';
    html += '<td style="white-space:nowrap;">';
    html += '<button class="btn-out btn-xs" onclick="openYearModal(\'' + y._id + '\')" style="margin-right:4px;">✏️</button>';
    if (!y.isCurrent) html += '<button class="btn-danger btn-xs" onclick="setYearAsCurrent(\'' + y._id + '\')">Set Current</button>';
    html += '</td></tr>';
  });
  tbody.innerHTML = html;
}

// Add / Edit Academic Year modal
function openYearModal(yearId) {
  document.getElementById('ym-title').textContent = yearId ? '📚 Edit Academic Year' : '📚 Add Academic Year';
  document.getElementById('ym-sub').textContent = yearId ? 'Update year and batch configurations' : 'Create a new academic year with batch configurations';
  document.getElementById('ym-id').value = yearId || '';
  document.getElementById('ym-delete-btn').style.display = yearId ? '' : 'none';
  document.getElementById('ym-acad-year').value = '';
  _ymCurrent = false;
  updateYmToggle(false);

  // Clear batch rows
  document.getElementById('ym-batch-rows').innerHTML = '';

  // Clear semester rows
  var semContainer = document.getElementById('ym-semester-rows');
  if (semContainer) semContainer.innerHTML = '';

  var autofillBar = document.getElementById('ym-autofill-bar');
  var currentYearRecord = yearsData.find(function(y) { return y.isCurrent; });

  if (yearId) {
    autofillBar.style.display = 'none';
    var year = yearsData.find(function(y) { return y._id === yearId; });
    if (year) {
      document.getElementById('ym-acad-year').value = year.academicYear || '';
      _ymCurrent = year.isCurrent || false;
      updateYmToggle(_ymCurrent);

      // Add batch rows for each batch
      year.batches.forEach(function(b) {
        addBatchRow(b.batchTrackId, b.batch, b.currentYear, b.currentSem);
      });

      // Add semester date rows if they exist
      if (year.semesterDates && year.semesterDates.length > 0) {
        year.semesterDates.forEach(function(sd) {
          addSemesterDateRow(sd.year, sd.semester, sd.startDate ? sd.startDate.split('T')[0] : '', sd.endDate ? sd.endDate.split('T')[0] : '');
        });
      }
    }
  } else {
    // New year — auto-suggest the next academic year string
    document.getElementById('ym-acad-year').value = suggestNextAcademicYear();
    autofillBar.style.display = currentYearRecord ? 'flex' : 'none';
    // Add one empty batch row for new year
    addBatchRow();
  }

  validateYearForm();
  openModal('year-modal-bg');
}

// Semester Dates Functions
function addSemesterDateRow(year, semester, startDate, endDate) {
  var container = document.getElementById('ym-semester-rows');
  if (!container) return;

  var rowId = 'sem-row-' + Date.now() + Math.floor(Math.random() * 1000);

  var html = '<div class="batch-row" id="' + rowId + '" style="background:var(--gP);border:1.5px solid var(--br);border-radius:10px;padding:12px;position:relative;margin-bottom:8px;">';
  html += '<button type="button" onclick="removeSemesterDateRow(\'' + rowId + '\')" style="position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#dc2626;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">✕</button>';

  html += '<div style="padding-right:30px;margin-bottom:9px;"><span class="batch-preview">Semester Info</span></div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">';
  html += '<div class="fg"><label class="fl">Year</label>';
  html += '<select class="fc2 sem-year" data-id="' + rowId + '" onchange="onSemYearChange(\'' + rowId + '\')">';
  html += '<option value="">— Select —</option>';
  ['I', 'II', 'III', 'IV'].forEach(function(y) {
    html += '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>Year ' + y + '</option>';
  });
  html += '</select></div>';

  html += '<div class="fg"><label class="fl">Semester</label>';
  html += '<select class="fc2 sem-semester" data-id="' + rowId + '"></select></div>';

  html += '<div class="fg"><label class="fl">Start Date</label>';
  html += '<input type="date" class="fc2 sem-start" data-id="' + rowId + '" value="' + (startDate || '') + '"></div>';

  html += '<div class="fg"><label class="fl">End Date</label>';
  html += '<input type="date" class="fc2 sem-end" data-id="' + rowId + '" value="' + (endDate || '') + '"></div>';
  html += '</div></div>';

  container.insertAdjacentHTML('beforeend', html);

  if (year) {
    populateSemesterOptions(rowId, year, semester);
  }

  updateSemesterCount();
}

function onSemYearChange(rowId) {
  var yearSelect = document.querySelector('.sem-year[data-id="' + rowId + '"]');
  var year = yearSelect.value;
  populateSemesterOptions(rowId, year, '');
}

function populateSemesterOptions(rowId, year, selectedSem) {
  var semSelect = document.querySelector('.sem-semester[data-id="' + rowId + '"]');
  if (!semSelect) return;

  if (!year) {
    semSelect.innerHTML = '<option value="">— Select Year first —</option>';
    return;
  }

  var YEAR_SEM_MAP = { I: ['I', 'II'], II: ['III', 'IV'], III: ['V', 'VI'], IV: ['VII', 'VIII'] };
  var semesters = YEAR_SEM_MAP[year] || [];
  var html = '<option value="">— Select —</option>';
  semesters.forEach(function(s) {
    html += '<option value="' + s + '"' + (s === selectedSem ? ' selected' : '') + '>Semester ' + s + '</option>';
  });
  semSelect.innerHTML = html;
}

function removeSemesterDateRow(rowId) {
  var row = document.getElementById(rowId);
  if (row) {
    row.remove();
    updateSemesterCount();
  }
}

function updateSemesterCount() {
  var container = document.getElementById('ym-semester-rows');
  if (!container) return;
  var count = container.querySelectorAll('.batch-row').length;
  var countEl = document.getElementById('ym-sem-count');
  if (countEl) countEl.textContent = count + (count === 1 ? ' semester' : ' semesters');
}

function collectSemesterDates() {
  var container = document.getElementById('ym-semester-rows');
  if (!container) return [];

  var rows = container.querySelectorAll('.batch-row');
  var semesterDates = [];

  rows.forEach(function(row) {
    var id = row.id;
    var year = row.querySelector('.sem-year[data-id="' + id + '"]')?.value;
    var semester = row.querySelector('.sem-semester[data-id="' + id + '"]')?.value;
    var startDate = row.querySelector('.sem-start[data-id="' + id + '"]')?.value;
    var endDate = row.querySelector('.sem-end[data-id="' + id + '"]')?.value;

    if (year && semester) {
      semesterDates.push({
        year: year,
        semester: semester,
        startDate: startDate || null,
        endDate: endDate || null
      });
    }
  });

  return semesterDates;
}

function autoFillFromCurrentYear() {
  var currentYearRecord = yearsData.find(function(y) { return y.isCurrent; });
  if (!currentYearRecord) { showToast('No current academic year to copy from', 'warn'); return; }

  var acadYear = document.getElementById('ym-acad-year').value.trim();
  if (!/^\d{4}-\d{4}$/.test(acadYear)) {
    showToast('Enter a valid Academic Year first (YYYY-YYYY)', 'warn');
    return;
  }

  document.getElementById('ym-batch-rows').innerHTML = '';

  var carried = 0, graduated = 0;
  currentYearRecord.batches.forEach(function(b) {
    var nextSem = nextSemester(b.currentSem);
    if (!nextSem) { graduated++; return; }
    var nextYearLevel = SEM_TO_YEAR[nextSem] || b.currentYear;
    addBatchRow(b.batchTrackId, b.batch, nextYearLevel, nextSem);
    carried++;
  });

  // Add a fresh Year I intake batch for the new academic year, if not already present
  var freshman = computeBatchForLevel(acadYear, 'I');
  if (freshman) {
    var existingIds = [];
    document.querySelectorAll('.batch-trackid').forEach(function(el) { existingIds.push(el.value); });
    if (existingIds.indexOf(freshman.trackId) === -1) {
      addBatchRow(freshman.trackId, freshman.batch, freshman.year, freshman.sem);
    }
  }

  validateYearForm();
  var msg = 'Auto-filled ' + carried + ' batch' + (carried === 1 ? '' : 'es') + ', advanced one semester, plus a new Year I intake.';
  if (graduated) msg += ' ' + graduated + ' batch' + (graduated === 1 ? '' : 'es') + ' graduated out.';
  showToast(msg, 'success');
}

function quickAddBatch(level) {
  var acadYear = document.getElementById('ym-acad-year').value.trim();
  if (!/^\d{4}-\d{4}$/.test(acadYear)) {
    showToast('Enter a valid Academic Year first (YYYY-YYYY)', 'warn');
    return;
  }
  var info = computeBatchForLevel(acadYear, level);
  if (!info) return;
  addBatchRow(info.trackId, info.batch, info.year, info.sem);
  showToast('Added Year ' + level + ' batch (' + info.batch + ')', 'success');
}

function addBatchRow(trackId, batch, year, sem) {
  var container = document.getElementById('ym-batch-rows');
  var rowId = 'batch-row-' + Date.now() + Math.floor(Math.random() * 1000);

  var html = '<div class="batch-row" id="' + rowId + '" style="background:var(--gP);border:1.5px solid var(--br);border-radius:10px;padding:12px;position:relative;">';
  html += '<button type="button" onclick="removeBatchRow(\'' + rowId + '\')" style="position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);color:#dc2626;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">✕</button>';

  html += '<div style="padding-right:30px;margin-bottom:9px;"><span class="batch-preview">Incomplete</span></div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">';
  html += '<div class="fg"><label class="fl">Batch Track ID <span style="color:#dc2626;">*</span></label>';
  html += '<input type="text" class="fc2 batch-trackid" placeholder="TR-BATCH-2630" value="' + (trackId || '') + '" oninput="validateYearForm();updateBatchPreview(this)"></div>';
  html += '<div class="fg"><label class="fl">Batch <span style="color:#dc2626;">*</span></label>';
  html += '<input type="text" class="fc2 batch-name" placeholder="2026-2030" value="' + (batch || '') + '" oninput="validateYearForm();autoBatchTrackId(this);updateBatchPreview(this)"></div>';
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
  html += '<div class="fg"><label class="fl">Current Year <span style="color:#dc2626;">*</span></label>';
  html += '<select class="fc2 batch-year" onchange="onBatchYearChange(this)">';
  html += '<option value="">— Select —</option>';
  ['I', 'II', 'III', 'IV'].forEach(function(y) {
    html += '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>Year ' + y + '</option>';
  });
  html += '</select></div>';

  html += '<div class="fg"><label class="fl">Current Semester <span style="color:#dc2626;">*</span></label>';
  html += '<select class="fc2 batch-sem"></select></div>';
  html += '</div></div>';

  container.insertAdjacentHTML('beforeend', html);

  var row = document.getElementById(rowId);
  populateSemOptions(row.querySelector('.batch-sem'), year, sem);
  row.querySelector('.batch-sem').setAttribute('onchange', 'validateYearForm();updateBatchPreview(this)');
  updateBatchPreview(row);
  validateYearForm();
}

function onBatchYearChange(selectEl) {
  var row = selectEl.closest('.batch-row');
  populateSemOptions(row.querySelector('.batch-sem'), selectEl.value, null);
  updateBatchPreview(row);
  validateYearForm();
}

function updateBatchPreview(rowOrEl) {
  var row = (rowOrEl.classList && rowOrEl.classList.contains('batch-row')) ? rowOrEl : rowOrEl.closest('.batch-row');
  if (!row) return;
  var prev = row.querySelector('.batch-preview');
  if (!prev) return;
  var year = row.querySelector('.batch-year').value;
  var sem = row.querySelector('.batch-sem').value;
  var batch = row.querySelector('.batch-name').value.trim();
  prev.textContent = (year && sem) ? (batch ? batch + ' — ' : '') + 'Year ' + year + ' • Sem ' + sem : 'Incomplete';
}

function removeBatchRow(rowId) {
  var row = document.getElementById(rowId);
  if (row) {
    row.remove();
    validateYearForm();
  }
}

function autoBatchTrackId(input) {
  var batchValue = input.value.trim();
  if (batchValue.match(/^\d{4}-\d{4}$/)) {
    var parts = batchValue.split('-');
    var trackId = 'TR-BATCH-' + parts[0].slice(-2) + parts[1].slice(-2);
    var row = input.closest('.batch-row');
    if (row) {
      var trackIdInput = row.querySelector('.batch-trackid');
      if (trackIdInput && !trackIdInput.value) {
        trackIdInput.value = trackId;
      }
    }
  }
}

function validateYearInput() {
  validateYearForm();
}

function validateYearForm() {
  var acadYear = document.getElementById('ym-acad-year').value.trim();
  var saveBtn = document.getElementById('ym-save-btn');
  var checkEl = document.getElementById('ym-acad-check');
  var countEl = document.getElementById('ym-batch-count');

  var validFormat = !!acadYear && /^\d{4}-\d{4}$/.test(acadYear);
  if (validFormat) {
    var parts = acadYear.split('-');
    if (parseInt(parts[1], 10) !== parseInt(parts[0], 10) + 1) validFormat = false;
  }

  checkEl.className = 'field-check';
  if (!acadYear) {
    checkEl.innerHTML = '<span style="color:var(--tdi);font-weight:500;">Format: YYYY-YYYY (e.g., 2026-2027)</span>';
  } else if (!validFormat) {
    checkEl.classList.add('bad');
    checkEl.innerHTML = '⚠️ Use format YYYY-YYYY with consecutive years';
  } else {
    checkEl.classList.add('ok');
    checkEl.innerHTML = '✓ Looks good';
  }

  var batchRows = document.querySelectorAll('.batch-row');
  if (countEl) countEl.textContent = batchRows.length + (batchRows.length === 1 ? ' batch' : ' batches');

  if (!validFormat || batchRows.length === 0) {
    saveBtn.disabled = true;
    saveBtn.style.opacity = '.5';
    saveBtn.style.cursor = 'not-allowed';
    return;
  }

  var allValid = true;
  var trackIds = [];
  batchRows.forEach(function(row) {
    var trackId = row.querySelector('.batch-trackid').value.trim();
    var batch = row.querySelector('.batch-name').value.trim();
    var year = row.querySelector('.batch-year').value;
    var sem = row.querySelector('.batch-sem').value;

    if (!trackId || !batch || !year || !sem) allValid = false;
    if (trackId) trackIds.push(trackId.toLowerCase());
  });

  var uniqueIds = trackIds.filter(function(id, i) { return trackIds.indexOf(id) === i; });
  if (uniqueIds.length !== trackIds.length) {
    allValid = false;
    if (countEl) countEl.textContent += ' — duplicate Track ID';
  }

  if (allValid) {
    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    saveBtn.style.cursor = 'pointer';
  } else {
    saveBtn.disabled = true;
    saveBtn.style.opacity = '.5';
    saveBtn.style.cursor = 'not-allowed';
  }
}

function toggleYmCurrent() {
  _ymCurrent = !_ymCurrent;
  updateYmToggle(_ymCurrent);
}

function updateYmToggle(val) {
  var t = document.getElementById('ym-current-toggle');
  t.classList.toggle('on', val);
  document.getElementById('ym-current-label').textContent = val ? 'Yes' : 'No';
  document.getElementById('ym-current-card').classList.toggle('on', val);

  var warn = document.getElementById('ym-current-warn');
  var existingCurrent = yearsData.find(function(y) { return y.isCurrent; });
  var editingId = document.getElementById('ym-id').value;
  if (warn) {
    if (val && existingCurrent && existingCurrent._id !== editingId) {
      warn.className = 'field-check bad';
      warn.innerHTML = '⚠️ Replaces "' + existingCurrent.academicYear + '" as the active year';
    } else {
      warn.className = 'field-check';
      warn.innerHTML = '';
    }
  }
}

function saveYear() {
  var id = document.getElementById('ym-id').value;
  var acadYear = document.getElementById('ym-acad-year').value.trim();
  
  if (!acadYear) { showToast('Academic year required', 'warn'); return; }
  
  // Collect batches from dynamic rows
  var batches = [];
  var batchRows = document.querySelectorAll('.batch-row');
  
  if (batchRows.length === 0) {
    showToast('At least one batch required', 'warn');
    return;
  }
  
  var hasError = false;
  var seenTrackIds = [];
  batchRows.forEach(function(row, index) {
    var trackId = row.querySelector('.batch-trackid').value.trim();
    var batch = row.querySelector('.batch-name').value.trim();
    var year = row.querySelector('.batch-year').value;
    var sem = row.querySelector('.batch-sem').value;
    
    if (!trackId || !batch || !year || !sem) {
      showToast('Please fill all fields for batch ' + (index + 1), 'warn');
      hasError = true;
      return;
    }
    if (seenTrackIds.indexOf(trackId.toLowerCase()) !== -1) {
      showToast('Duplicate Track ID: ' + trackId, 'warn');
      hasError = true;
      return;
    }
    seenTrackIds.push(trackId.toLowerCase());
    
    batches.push({
      batchTrackId: trackId,
      batch: batch,
      currentYear: year,
      currentSem: sem
    });
  });
  
  if (hasError) return;

  // Collect semester dates
  var semesterDates = collectSemesterDates();

  dbToast('Saving…', 'saving');
  var payload = {
    academicYear: acadYear,
    batches: batches,
    semesterDates: semesterDates,
    isCurrent: _ymCurrent
  };
  apiCall(id ? 'PUT' : 'POST', id ? '/year/' + id : '/year', payload)
    .then(function(r) {
      dbToast('Year saved', 'success');
      closeModal('year-modal-bg');
      loadYears();
    }).catch(function(err) { dbToast('Error: ' + (err&&err.message?err.message:'Server error'), 'error'); });
}

function deleteYear() {
  if (!confirm('Delete this academic year?')) return;
  var id = document.getElementById('ym-id').value;
  dbToast('Deleting…', 'saving');
  apiCall('DELETE', '/year/' + id)
    .then(function(r) {
      dbToast('Year deleted', 'success');
      closeModal('year-modal-bg');
      loadYears();
    }).catch(function(err) { dbToast('Error: ' + (err&&err.message?err.message:'Server error'), 'error'); });
}

function setYearAsCurrent(yearId) {
  if (!confirm('Set this as the current academic year?')) return;
  dbToast('Updating…', 'saving');
  apiCall('PUT', '/year/' + yearId, { isCurrent: true })
    .then(function(r) {
      dbToast('Current year updated', 'success');
      loadYears();
    }).catch(function(err) { dbToast('Error: ' + (err&&err.message?err.message:'Server error'), 'error'); });
}

// Edit Batch modal
function openBatchModal(yearId, batchTrackId, batch, currentYear, currentSem) {
  document.getElementById('bm-title').textContent = 'Edit Batch: ' + batch;
  document.getElementById('bm-sub').textContent = 'Update current year and semester for ' + batch;
  document.getElementById('bm-year-id').value = yearId;
  document.getElementById('bm-batch-track-id').value = batchTrackId;
  document.getElementById('bm-current-year').value = currentYear;
  populateSemOptions(document.getElementById('bm-current-sem'), currentYear, currentSem);
  updateBmPreview();
  openModal('batch-modal-bg');
}

function onBmYearChange() {
  var yr = document.getElementById('bm-current-year').value;
  populateSemOptions(document.getElementById('bm-current-sem'), yr, null);
  updateBmPreview();
}

function updateBmPreview() {
  var yr = document.getElementById('bm-current-year').value;
  var sem = document.getElementById('bm-current-sem').value;
  document.getElementById('bm-preview').textContent = 'Year ' + yr + ' • Sem ' + sem;
  var advBtn = document.getElementById('bm-advance-btn');
  if (yr === 'IV' && sem === 'VIII') {
    advBtn.disabled = true;
    advBtn.style.opacity = '.5';
    advBtn.style.cursor = 'not-allowed';
    advBtn.textContent = '🏁 Final Semester';
  } else {
    advBtn.disabled = false;
    advBtn.style.opacity = '1';
    advBtn.style.cursor = 'pointer';
    advBtn.textContent = '⏭ Advance to Next Sem';
  }
}

function advanceBatchModalSem() {
  var sem = document.getElementById('bm-current-sem').value;
  var next = nextSemester(sem);
  if (!next) { showToast('Already at the final semester', 'warn'); return; }
  var nextYearLevel = SEM_TO_YEAR[next];
  document.getElementById('bm-current-year').value = nextYearLevel;
  populateSemOptions(document.getElementById('bm-current-sem'), nextYearLevel, next);
  updateBmPreview();
}

function saveBatch() {
  var yearId = document.getElementById('bm-year-id').value;
  var batchTrackId = document.getElementById('bm-batch-track-id').value;
  var currentYear = document.getElementById('bm-current-year').value;
  var currentSem = document.getElementById('bm-current-sem').value;
  var year = yearsData.find(function(y) { return y._id === yearId; });
  if (!year) { showToast('Year not found', 'warn'); return; }
  var updatedBatches = year.batches.map(function(b) {
    if (b.batchTrackId === batchTrackId) {
      return { batchTrackId: b.batchTrackId, batch: b.batch, currentYear: currentYear, currentSem: currentSem };
    }
    return b;
  });
  dbToast('Saving…', 'saving');
  apiCall('PUT', '/year/' + yearId, { batches: updatedBatches })
    .then(function(r) {
      dbToast('Batch updated', 'success');
      closeModal('batch-modal-bg');
      loadYears();
    }).catch(function(err) { dbToast('Error: ' + (err&&err.message?err.message:'Server error'), 'error'); });
}