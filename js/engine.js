/* Import engine shared with csv-sanitizer.html (copied from its CORE block; keep the two in step).
   CSV parsing, column detection, description normalising, rule matching, and importRows (never drops a line). */
var Engine = (function () {

function rnd(){var a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296;}
function escapeRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function parseCSV(text){
  if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  var head=text.split(/\r?\n/).slice(0,10).join('\n');
  var delim=',',best=-1,cands=[',',';','\t'];
  for(var d=0;d<cands.length;d++){var c=head.split(cands[d]).length;if(c>best){best=c;delim=cands[d];}}
  var rows=[],row=[],cell='',q=false;
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; }
      else cell+=ch;
    } else if(ch==='"'&&cell===''){ q=true; }
    else if(ch===delim){ row.push(cell); cell=''; }
    else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&text[i+1]==='\n') i++;
      row.push(cell); cell=''; rows.push(row); row=[];
    } else cell+=ch;
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return {rows:rows,delim:delim};
}
function toCSV(rows,delim){
  delim=delim||',';
  return rows.map(function(r){return r.map(function(c){
    c=String(c==null?'':c);
    return (c.indexOf(delim)>=0||c.indexOf('"')>=0||/[\r\n]/.test(c))?'"'+c.replace(/"/g,'""')+'"':c;
  }).join(delim);}).join('\r\n')+'\r\n';
}

var DATE_RE=/^\s*(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ ,-]*\d{2,4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})(\s.*)?$/;
function isDate(s){return DATE_RE.test(s||'');}
var HEADER_RE=/date|desc|detail|amount|debit|credit|balance|merchant|payee|memo|narrat|withdraw|deposit|transaction|type|category|reference|posted/i;
var NUM_RE=/^[-+(]?[$€£]?\s*[\d,]*\.?\d+\)?$/;

function detectLayout(rows){
  var headerIdx=-1,dataStart=-1;
  for(var i=0;i<Math.min(rows.length,30);i++){
    var r=rows[i];
    var ne=r.filter(function(c){return c.trim()!=='';});
    if(ne.length>=3){
      var hits=ne.filter(function(c){return HEADER_RE.test(c)&&!/\d{3,}/.test(c);}).length;
      var hasDate=r.some(isDate);
      if(hits>=2&&!hasDate){headerIdx=i;dataStart=i+1;break;}
      if(hasDate){dataStart=i;break;}
    }
  }
  if(dataStart<0) dataStart=0;
  var width=0;
  rows.slice(dataStart,dataStart+50).forEach(function(r){if(r.length>width)width=r.length;});
  if(headerIdx>=0&&rows[headerIdx].length>width) width=rows[headerIdx].length;
  var sample=rows.slice(dataStart,dataStart+200).filter(function(r){return r.length>=3;});
  var cols={date:-1,desc:-1,amount:-1,debit:-1,credit:-1};
  var hdr=headerIdx>=0?rows[headerIdx]:[];
  hdr.forEach(function(h,i){
    var t=h.toLowerCase();
    if(cols.date<0&&/date/.test(t)) cols.date=i;
    else if(/direction|indicator|\bflow\b|debit.?credit|credit.?debit|dr.?cr/.test(t)){ /* a direction flag column, not an amount column */ }
    else if(cols.debit<0&&/debit|withdraw|paid out|money out/.test(t)) cols.debit=i;
    else if(cols.credit<0&&/credit|deposit|paid in|money in/.test(t)) cols.credit=i;
    else if(cols.amount<0&&/^(amount|cad|usd|value|transaction amount|net.?cash.?amount|net.?amount)/.test(t)) cols.amount=i;
  });
  /* description column: score the headers so "Merchant Name" beats "Merchant Category Description" */
  var bestScore=0;
  hdr.forEach(function(h,i){
    var t=h.toLowerCase(), sc=0;
    if(i===cols.date||i===cols.amount||i===cols.debit||i===cols.credit) return;
    if(/category|city|state|province|country|postal|zip|code|status|type|number|card|account|reference|name on|member|posted/.test(t)&&!/merchant.?name|payee/.test(t)) return;
    if(/merchant.?name|payee/.test(t)) sc=6;
    else if(/^(description|transaction description|details?|narrative)/.test(t)) sc=5;
    else if(/desc|detail|narrat|memo/.test(t)) sc=3;
    else if(/merchant|name/.test(t)) sc=2;
    if(sc>bestScore){bestScore=sc;cols.desc=i;}
  });
  var st=[];
  for(var c=0;c<width;c++){
    var vals=sample.map(function(r){return (r[c]||'').trim();}).filter(function(v){return v!=='';});
    var n=vals.length||1;
    st[c]={
      date:vals.filter(isDate).length/n,
      num:vals.filter(function(v){return NUM_RE.test(v);}).length/n,
      dec:vals.filter(function(v){return /\.\d{1,2}\)?$/.test(v);}).length/n,
      len:vals.reduce(function(a,v){return a+v.length;},0)/n,
      filled:vals.length
    };
  }
  if(cols.date<0){for(var a=0;a<st.length;a++){if(st[a].date>0.8){cols.date=a;break;}}}
  if(cols.desc<0){
    var b=-1,bl=0;
    st.forEach(function(s,i){if(i!==cols.date&&s.date<0.5&&s.num<0.5&&s.len>bl){bl=s.len;b=i;}});
    cols.desc=b;
  }
  if(cols.amount<0&&cols.debit<0&&cols.credit<0){
    for(var d=0;d<st.length;d++){if(d!==cols.date&&st[d].num>0.8&&st[d].dec>0.5&&st[d].filled>0){cols.amount=d;break;}}
  }
  return {headerIdx:headerIdx,dataStart:dataStart,cols:cols,width:width};
}
/* Files from the same bank have the same header (or, with no header, the same shape). */
function layoutSignature(rows,L){
  if(L.headerIdx>=0) return 'H|'+rows[L.headerIdx].map(function(c){return c.trim().toLowerCase().replace(/\d{4,}/g,'#');}).join('|');
  return 'N|'+L.width+'|'+[L.cols.date,L.cols.desc,L.cols.amount,L.cols.debit,L.cols.credit].join(',');
}
function countTx(rows,L){
  var n=0;
  for(var i=L.dataStart;i<rows.length;i++){
    var r=rows[i];
    if(r.every(function(c){return c.trim()==='';})) continue;
    if(L.cols.date>=0&&!isDate(r[L.cols.date])) continue;
    n++;
  }
  return n;
}

/* Other columns are cleared unless kept. A column is suggested for keeping only when its header says
   type / direction / currency / status / category AND its values look like a short list of codes. */
var KEEP_HDR_RE=/direction|indicator|type|flow|debit.?credit|credit.?debit|dr.?cr|currency|status|category|kind/i;
function columnProfile(rows,L,j){
  var cnt={},n=0;
  for(var i=L.dataStart;i<Math.min(rows.length,L.dataStart+500);i++){
    var v=((rows[i]||[])[j]||'').trim();
    if(!v) continue;
    cnt[v]=(cnt[v]||0)+1;n++;
  }
  var vals=Object.keys(cnt).sort(function(a,b){return cnt[b]-cnt[a];});
  var avg=vals.length?vals.reduce(function(a,v){return a+v.length;},0)/vals.length:0;
  var codey=n>0&&vals.length<=12&&avg<=30&&!vals.some(function(v){return /\d{4,}/.test(v);});
  return {values:vals,codey:codey};
}
function suggestKeep(rows,L){
  var keep={},hdr=L.headerIdx>=0?rows[L.headerIdx]:[],used={};
  Object.keys(L.cols).forEach(function(k){if(L.cols[k]>=0) used[L.cols[k]]=1;});
  for(var j=0;j<L.width;j++){
    if(used[j]) continue;
    if(KEEP_HDR_RE.test(hdr[j]||'')&&columnProfile(rows,L,j).codey) keep[j]=true;
  }
  return keep;
}

function normalize(desc){
  var s=String(desc||'').toUpperCase();
  s=s.replace(/E[\s-]?TRANSFER/g,'E TRANSFER');
  s=s.replace(/[^A-Z0-9&]+/g,' ').trim();
  var t=s.split(' ').filter(Boolean);
  var PRE={POS:1,PURCHASE:1,DEBIT:1,SQ:1,TST:1,PAYPAL:1,PP:1,CONTACTLESS:1,TAP:1,INTERAC:1};
  while(t.length>1&&PRE[t[0]]) t.shift();
  t=t.filter(function(w){
    if(/^\d{3,}$/.test(w)) return false;
    if(w.length>=5&&/^[A-Z0-9]+$/.test(w)&&/\d{2,}/.test(w)&&/[A-Z]/.test(w)) return false;
    return true;
  });
  return t.join(' ');
}
/* Merchant key for grouping: normalized, trailing store numbers removed. */
function merchantKey(desc){
  var n=normalize(desc).replace(/(\s\d+)+$/,'');
  return n||normalize(desc);
}

function loadRules(rows){
  var h=rows[0].map(function(x){return x.trim().toLowerCase();});
  function ix(n){return h.indexOf(n);}
  var rules=[];
  for(var i=1;i<rows.length;i++){
    var r=rows[i]; var p=r[ix('pattern')];
    if(!p) continue;
    var m=(r[ix('match_type')]||'contains').trim();
    rules.push({
      id:r[ix('rule_id')],kind:(r[ix('kind')]||'').trim(),
      pattern:m==='regex'?p.trim():p.trim().toUpperCase(),match:m,
      value:(r[ix('value')]||'').trim(),priority:parseInt(r[ix('priority')],10)||100,
      apply:(r[ix('apply')]||'auto').trim(),
      /* optional conditions (v12): amount range (absolute CAD) and money in/out; empty = any */
      min:num(r[ix('min_amount')]),max:num(r[ix('max_amount')]),dir:dirOf(r[ix('direction')])
    });
  }
  return rules;
}
function num(v){v=String(v==null?'':v).replace(/[$,\s]/g,'');return v===''||isNaN(+v)?null:Math.abs(+v);}
function dirOf(v){v=String(v||'').trim().toLowerCase();return v==='in'||v==='out'?v:null;}
function hasCond(r){return r.min!=null||r.max!=null||r.dir!=null;}
/* A rule with conditions only matches when the amount/direction are known and fit (ctx = {amount, direction}). */
function condOk(r,ctx){
  if(!hasCond(r)) return true;
  if(!ctx) return false;
  if(r.dir&&ctx.direction!==r.dir) return false;
  if(r.min!=null||r.max!=null){
    if(ctx.amount==null||isNaN(ctx.amount)) return false;
    var a=Math.abs(ctx.amount);
    if(r.min!=null&&a<r.min) return false;
    if(r.max!=null&&a>r.max) return false;
  }
  return true;
}
function ruleHit(n,r){
  switch(r.match){
    case 'startswith': return n.indexOf(r.pattern)===0;
    case 'exact': return n===r.pattern;
    case 'word': return (' '+n+' ').indexOf(' '+r.pattern+' ')>=0;
    case 'regex': try{return new RegExp(r.pattern).test(n);}catch(e){return false;}
    default: return n.indexOf(r.pattern)>=0;
  }
}
/* Highest priority wins; then the longer pattern; then a rule with conditions (it is more specific). */
function bestRule(n,rules,kind,ctx){
  var b=null;
  for(var i=0;i<rules.length;i++){
    var r=rules[i];
    if(r.kind!==kind||!ruleHit(n,r)||!condOk(r,ctx)) continue;
    if(!b||r.priority>b.priority||(r.priority===b.priority&&(r.pattern.length>b.pattern.length||(r.pattern.length===b.pattern.length&&hasCond(r)&&!hasCond(b))))) b=r;
  }
  return b;
}
function classify(desc,rules,ctx){
  var n=normalize(desc);
  var t=bestRule(n,rules,'type',ctx),c=bestRule(n,rules,'category',ctx);
  var status;
  if(t&&t.value==='review') status='review';
  else if(t&&(t.value==='transfer'||t.value==='income'||t.value==='exclude')) status='type'; /* exclude = kept, never counted */
  else if(c) status=c.apply==='suggest'?'suggested':'auto';
  else status='unmatched';
  return {norm:n,type:t?t.value:'',typeApply:t?t.apply:'',typeRule:t?t.id:'',category:c?c.value:'',catApply:c?c.apply:'',catRule:c?c.id:'',status:status};
}


/* ---------- Import engine: every input line is accounted for, none is dropped ---------- */
var MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function pad2(n){return (n<10?'0':'')+n;}
function validYMD(y,m,d){
  if(!(y>=1990&&y<=2100&&m>=1&&m<=12&&d>=1&&d<=31)) return false;
  var dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}
/* Returns {iso, ambiguous} or null. order: 'MDY' or 'DMY' decides purely numeric dates like 03/04/2024. */
function parseDateStr(s,order){
  s=String(s||'').trim(); var m;
  if((m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/))){
    return validYMD(+m[1],+m[2],+m[3])?{iso:m[1]+'-'+pad2(+m[2])+'-'+pad2(+m[3]),ambiguous:false}:null;
  }
  if((m=s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ ,-]*(\d{2,4})$/))){
    var mo=MONTHS[m[2].slice(0,3).toLowerCase()],y=+m[3]; if(y<100) y+=2000;
    return mo&&validYMD(y,mo,+m[1])?{iso:y+'-'+pad2(mo)+'-'+pad2(+m[1]),ambiguous:false}:null;
  }
  if((m=s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/))){
    var mo2=MONTHS[m[1].slice(0,3).toLowerCase()];
    return mo2&&validYMD(+m[3],mo2,+m[2])?{iso:m[3]+'-'+pad2(mo2)+'-'+pad2(+m[2]),ambiguous:false}:null;
  }
  if((m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:\s.*)?$/))){
    var a=+m[1],b=+m[2],yy=+m[3]; if(yy<100) yy+=2000;
    var first=order==='DMY'?'D':'M';
    var d1=first==='D'?a:b, m1=first==='D'?b:a;
    if(m1>12&&d1<=12){var t=d1;d1=m1;m1=t;} /* only one reading is possible */
    if(!validYMD(yy,m1,d1)) return null;
    return {iso:yy+'-'+pad2(m1)+'-'+pad2(d1),ambiguous:a<=12&&b<=12&&a!==b};
  }
  return null;
}
/* Guess D/M vs M/D from the whole file: a first part above 12 means DMY, a second part above 12 means MDY.
   No evidence either way: dates written with dots (01.10.2026) are day first; otherwise month first. */
function guessDateOrder(vals){
  var dmy=0,mdy=0,dots=0,seen=0;
  vals.forEach(function(v){
    var m=String(v||'').trim().match(/^(\d{1,2})([-\/.])(\d{1,2})[-\/.]\d{2,4}/);
    if(m){ seen++; if(m[2]==='.') dots++; if(+m[1]>12) dmy++; if(+m[3]>12) mdy++; }
  });
  if(dmy===mdy&&seen&&dots===seen) return 'DMY';
  return dmy>mdy?'DMY':'MDY';
}
/* Returns a number (negative = money out as written in the file) or null when it cannot be read. */
function parseAmountStr(s){
  var t=String(s==null?'':s).trim();
  if(t==='') return null;
  var neg=false;
  if(/^\(.*\)$/.test(t)){neg=true;t=t.slice(1,-1);}
  if(/(CR|DR)\s*$/i.test(t)){ if(/DR\s*$/i.test(t)) neg=!neg; t=t.replace(/(CR|DR)\s*$/i,''); }
  if(/-\s*$/.test(t)){neg=!neg;t=t.replace(/-\s*$/,'');}
  if(/^\s*-/.test(t)){neg=!neg;t=t.replace(/^\s*-/,'');}
  t=t.replace(/^\s*\+/,'').replace(/[$€£\s]/g,'').replace(/^(CAD|USD|C\$|US\$)/i,'');
  if(/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) t=t.replace(/\./g,'').replace(',','.'); /* 1.234,56 */
  else if(/^\d+,\d{1,2}$/.test(t)) t=t.replace(',','.');                              /* 12,50 */
  else t=t.replace(/,/g,'');
  if(!/^\d*\.?\d+$/.test(t)&&!/^\d+\.$/.test(t)) return null;
  var v=parseFloat(t); if(!isFinite(v)) return null;
  return neg?-v:v;
}
/* Turns EVERY input line into an entry. Nothing is dropped: the only lines not turned into a transaction are
   completely empty ones, and those are counted. Statuses:
   ok = read and tagged;  tag = read but needs your tag (suggested / review / unmatched);
   error = could not read the date or amount (kept with the reason);  blank = empty line (counted);
   header = the column-names line;  preamble = text above the header (kept, counted).
   o.dirCol: optional money-in / money-out column for files whose amount has no sign (Debit/Credit, DR/CR, Inflow/Outflow).
   o.codeCol: optional transaction-code column added to the text that rules match (e.g. Wealthsimple AFT_OUT).
   o.hintCol: optional second text column (e.g. a merchant category) tried when the description matches no rule.
   o.signMode: 'card' (purchases are positive in the file) or 'bank' (money out is negative). */
/* Direction words used by files that give an unsigned amount plus a money-in / money-out column. */
var DIR_OUT=/^(debit|dr|d|db|withdrawal|withdraw|outflow|out|purchase|payment out|sent|spend|charge)$/;
var DIR_IN=/^(credit|cr|c|deposit|inflow|in|received|refund|payment received)$/;
function importRows(rows,L,rules,o){
  o=o||{};
  var entries=[],c=L.cols,seen={};
  var dateVals=(c.date>=0)?rows.slice(L.dataStart).map(function(r){return r[c.date];}):[];
  var order=o.dateOrder||guessDateOrder(dateVals);
  var mapped=(c.date>=0)&&(c.desc>=0)&&(c.amount>=0||c.debit>=0||c.credit>=0);
  for(var i=0;i<rows.length;i++){
    var r=rows[i],e={line:i+1,raw:r,status:'',reason:'',date:'',amount:null,desc:'',type:'',category:'',flags:[]};
    entries.push(e);
    if(r.every(function(x){return String(x).trim()==='';})){e.status='blank';continue;}
    if(i<L.dataStart){e.status=(i===L.headerIdx)?'header':'preamble';continue;}
    if(!mapped){e.status='error';e.reason='Layout not recognized: choose the date, description and amount columns for this file';continue;}
    var problems=[];
    var dv=parseDateStr(r[c.date],order);
    if(dv){e.date=dv.iso; if(dv.ambiguous) e.flags.push('date order assumed '+order);} else problems.push('date "'+String(r[c.date]||'').trim()+'" not readable');
    var amt=null;
    if(c.amount>=0){
      amt=parseAmountStr(r[c.amount]);
      if(amt===null) problems.push('amount "'+String(r[c.amount]||'').trim()+'" not readable');
    } else {
      var dr=c.debit>=0?parseAmountStr(r[c.debit]):null, cr=c.credit>=0?parseAmountStr(r[c.credit]):null;
      if(dr===null&&cr===null) problems.push('no debit or credit amount');
      else if(dr!==null&&cr!==null&&dr!==0&&cr!==0) problems.push('both debit and credit are filled');
      else amt=(cr!==null&&cr!==0)?Math.abs(cr):-Math.abs(dr||0);
    }
    if(amt!==null&&o.dirCol>=0&&c.amount>=0){
      var dir=String(r[o.dirCol]||'').trim().toLowerCase();
      if(DIR_OUT.test(dir)) amt=-Math.abs(amt); else if(DIR_IN.test(dir)) amt=Math.abs(amt); else problems.push('direction "'+dir+'" not readable');
      if(amt!==null&&problems.length===0) e.amount=amt;
    } else if(amt!==null){ if(o.signMode==='card'&&c.amount>=0) amt=-amt; e.amount=amt; }
    e.desc=String(r[c.desc]||'').trim();
    if(e.desc==='') {e.flags.push('empty description');}
    if(problems.length){e.status='error';e.reason=problems.join('; ');continue;}
    if(o.codeCol>=0&&r[o.codeCol]) e.code=String(r[o.codeCol]).trim();
    var ctx={amount:e.amount,direction:e.amount<0?'out':'in'};
    var k=classify(e.code?e.desc+' '+e.code:e.desc,rules,ctx);
    e.match=k;
    if(k.status==='unmatched'&&o.hintCol>=0&&r[o.hintCol]){var k2=classify(r[o.hintCol],rules,ctx);if(k2.status!=='unmatched'){k=k2;e.flags.push('tagged from category text');}}
    e.type=k.type;e.category=k.category;
    var sp=splitFor(e.desc,e.amount,rules); if(sp){e.splits=sp.parts;e.flags.push('split by rule '+sp.rule);}
    e.status=(k.status==='auto'||k.status==='type')?'ok':'tag';
    e.rule=k.status;
    var key=e.date+'|'+e.amount+'|'+k.norm;
    if(seen[key]) {e.flags.push('possible duplicate of line '+seen[key]);} else seen[key]=e.line;
  }
  var sm={total:rows.length,ok:0,tag:0,error:0,blank:0,header:0,preamble:0};
  entries.forEach(function(e){sm[e.status]++;});
  sm.accounted=sm.ok+sm.tag+sm.error+sm.blank+sm.header+sm.preamble;
  sm.reconciled=(sm.accounted===rows.length&&entries.length===rows.length);
  sm.dateOrder=order;
  return {entries:entries,summary:sm};
}


/* Split rules (kind "split"): one bank line becomes several category parts.
   value example: "Fees & Admin=1.75%;Rent=rest"  -> a percentage is a surcharge on the rest
   (fee = total x p / (1 + p)), "rest" takes what is left, a plain number is a fixed amount. */
function splitFor(desc,amount,rules){
  var r=bestRule(normalize(desc),rules,'split',{amount:amount,direction:amount<0?'out':'in'}); if(!r) return null;
  var total=Math.abs(amount),sign=amount<0?-1:1,parts=[],restCat=null,used=0,pct=0;
  r.value.split(';').forEach(function(p){
    var kv=p.split('='),cat=(kv[0]||'').trim(),v=(kv[1]||'').trim();
    if(/^rest$/i.test(v)) restCat=cat;
    else if(/%$/.test(v)){ pct+=parseFloat(v)/100; parts.push({category:cat,pct:parseFloat(v)/100}); }
    else { var f=parseFloat(v); parts.push({category:cat,fixed:f}); used+=f; }
  });
  var base=(total-used)/(1+pct);
  var out=parts.map(function(p){
    var a=p.fixed!=null?p.fixed:Math.round(base*p.pct*100)/100;
    return {category:p.category,amount:a};
  });
  var sum=out.reduce(function(s,p){return s+p.amount;},0);
  if(restCat) out.push({category:restCat,amount:Math.round((total-sum)*100)/100});
  out.forEach(function(p){p.amount=sign*p.amount;});
  return {rule:r.id,parts:out};
}

function maskDesc(s,words){
  s=String(s||'');
  (words||[]).forEach(function(w){ if(w) s=s.replace(new RegExp(escapeRe(w),'gi'),'[REDACTED]'); });
  s=s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g,'[EMAIL]');
  s=s.replace(/(E[\s-]?TRANSFER|\bTFR\b|\bZELLE\b|\bVENMO\b|\bTRANSFER\b)(\s*[-:]?\s*(?:FROM|TO|SENT|RECEIVED|SEND|RECEIVE|REQUEST)\b)?[\s\S]*$/i,function(m,k,d){
    var rest=m.slice(k.length+(d||'').length);
    return rest.trim()===''?m:k+(d||'')+' [NAME]';
  });
  s=s.replace(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/g,'[PHONE]');
  s=s.replace(/\d{4,}/g,function(m){return 'X'.repeat(Math.min(m.length,6));});
  return s;
}
function shiftDate(s,n){
  var done=false;
  s=String(s).replace(/\b(19|20)\d{2}\b/,function(m){done=true;return String(parseInt(m,10)-n);});
  if(!done) s=s.replace(/([-\/.])(\d{2})(\s|$)/,function(m,sep,yy,end){return sep+String((parseInt(yy,10)-n+100)%100).padStart(2,'0')+end;});
  return s;
}
function scaleAmount(s,f){
  return String(s).replace(/\d[\d,]*\.?\d*/,function(tok){
    var dec=tok.indexOf('.')>=0?tok.split('.')[1].length:0;
    var v=parseFloat(tok.replace(/,/g,''))*f;
    var out=v.toFixed(dec);
    if(tok.indexOf(',')>=0){var p=out.split('.');p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');out=p.join('.');}
    return out;
  });
}

/* o.seen: optional object shared between files so a merchant is only kept once across them. */
function sanitize(rows,L,o){
  var out=[],stats={kept:0,dropped:0};
  var h=L.headerIdx;
  var startKeep=h>=0?h:L.dataStart;
  if(startKeep>0){
    if(o.removeAbove) out.push(['[ '+startKeep+' line(s) above the header removed ]']);
    else for(var i=0;i<startKeep;i++) out.push(rows[i].map(function(c){return maskDesc(c,o.words);}));
  }
  if(h>=0) out.push(rows[h].map(function(c){return c.replace(/\d{4,}/g,'XXXX');}));
  var seen=o.seen||{};
  var C=L.cols;
  for(var r=L.dataStart;r<rows.length;r++){
    var row=rows[r];
    if(row.every(function(c){return c.trim()==='';})) continue;
    if(C.date>=0&&!isDate(row[C.date])){stats.dropped++;continue;}
    var desc=C.desc>=0?maskDesc(row[C.desc],o.words):'';
    if(o.distinct){
      /* Group by the first three words of the merchant key so store numbers and city codes do not create duplicates. */
      var k=merchantKey(C.desc>=0?row[C.desc]:'').split(' ').slice(0,3).join(' ')||('ROW'+r);
      /* Rows that differ in a kept code column (type, direction...) count as different. */
      if(L.keep) Object.keys(L.keep).forEach(function(j){if(L.keep[j]) k+='|'+String(row[j]||'').trim().toUpperCase();});
      if(seen[k]||stats.kept>=o.maxRows) continue;
      seen[k]=1;
    }
    var f=0.6+0.8*rnd();
    out.push(row.map(function(c,j){
      if(j===C.date) return o.shiftYears?shiftDate(c,o.yearShift):c;
      if(j===C.desc) return desc;
      if(j===C.amount||j===C.debit||j===C.credit) return o.scale?scaleAmount(c,f):c;
      if(o.clearOthers&&!(L.keep&&L.keep[j])) return '';
      return maskDesc(c,o.words);
    }));
    stats.kept++;
  }
  return {rows:out,stats:stats};
}

function coverage(rows,L,rules,words){
  var res={total:0,auto:0,suggested:0,type:0,review:0,unmatched:0,unreadable:0},um={};
  for(var i=L.dataStart;i<rows.length;i++){
    var r=rows[i];
    if(r.every(function(c){return c.trim()==='';})) continue;
    if(L.cols.date>=0&&!isDate(r[L.cols.date])){res.unreadable++;continue;}
    var d=L.cols.desc>=0?r[L.cols.desc]:'';
    var c=classify(d,rules);
    res.total++;res[c.status]++;
    if(c.status==='unmatched'){
      var k=maskDesc(merchantKey(d),words)||'(blank)';
      um[k]=(um[k]||0)+1;
    }
  }
  res.list=Object.keys(um).map(function(k){return [k,um[k]];}).sort(function(a,b){return b[1]-a[1];});
  return res;
}
/* Combine several coverage results (one per file) into one. */
function mergeCoverage(list){
  var agg={total:0,auto:0,suggested:0,type:0,review:0,unmatched:0,unreadable:0},um={};
  list.forEach(function(c){
    ['total','auto','suggested','type','review','unmatched','unreadable'].forEach(function(k){agg[k]+=c[k];});
    c.list.forEach(function(e){um[e[0]]=(um[e[0]]||0)+e[1];});
  });
  agg.list=Object.keys(um).map(function(k){return [k,um[k]];}).sort(function(a,b){return b[1]-a[1]||(a[0]<b[0]?-1:1);});
  return agg;
}

/* Minimal ZIP writer (stored, no compression) so many files download as one. */
function crc32(buf){
  var t=crc32.t;
  if(!t){t=crc32.t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}}
  var crc=0xFFFFFFFF;
  for(var i=0;i<buf.length;i++) crc=t[(crc^buf[i])&0xFF]^(crc>>>8);
  return (crc^0xFFFFFFFF)>>>0;
}
function makeZip(files){
  var enc=new TextEncoder(),parts=[],central=[],offset=0,d=new Date();
  var dosTime=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1);
  var dosDate=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  files.forEach(function(f){
    var nameB=enc.encode(f.name),crc=crc32(f.data),size=f.data.length;
    var lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);
    lh.setUint16(10,dosTime,true);lh.setUint16(12,dosDate,true);lh.setUint32(14,crc,true);
    lh.setUint32(18,size,true);lh.setUint32(22,size,true);lh.setUint16(26,nameB.length,true);lh.setUint16(28,0,true);
    parts.push(new Uint8Array(lh.buffer),nameB,f.data);
    var ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);
    ch.setUint16(12,dosTime,true);ch.setUint16(14,dosDate,true);ch.setUint32(16,crc,true);
    ch.setUint32(20,size,true);ch.setUint32(24,size,true);ch.setUint16(28,nameB.length,true);
    ch.setUint16(30,0,true);ch.setUint16(32,0,true);ch.setUint16(34,0,true);ch.setUint16(36,0,true);ch.setUint32(38,0,true);ch.setUint32(42,offset,true);
    central.push(new Uint8Array(ch.buffer),nameB);
    offset+=30+nameB.length+size;
  });
  var csize=0;central.forEach(function(p){csize+=p.length;});
  var end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);
  end.setUint32(12,csize,true);end.setUint32(16,offset,true);
  var all=parts.concat(central,[new Uint8Array(end.buffer)]),total=0;
  all.forEach(function(p){total+=p.length;});
  var out=new Uint8Array(total),pos=0;
  all.forEach(function(p){out.set(p,pos);pos+=p.length;});
  return out;
}

return {parseCSV: parseCSV, detectLayout: detectLayout, layoutSignature: layoutSignature, normalize: normalize, merchantKey: merchantKey, loadRules: loadRules, classify: classify, parseDateStr: parseDateStr, parseAmountStr: parseAmountStr, guessDateOrder: guessDateOrder, importRows: importRows, splitFor: splitFor, isDate: isDate, DIR_OUT: DIR_OUT, DIR_IN: DIR_IN};
})();
