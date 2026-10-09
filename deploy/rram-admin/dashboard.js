const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('ru-RU');
const names = new Intl.DisplayNames(['ru'],{type:'region'});
const platformNames={site:'RRaM',yandex:'Яндекс Игры',crazygames:'CrazyGames',telegram:'Telegram',local:'Локально',unknown:'Не определена'};
const modeNames={pvp:'PvP',ai:'Против ИИ',tutorial:'Обучение',lobby:'Лобби / просмотр'};
const date=t=>new Date(t).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const duration=s=>s==null?'—':s>=3600?(s/3600).toFixed(1)+' ч':s>=60?Math.round(s/60)+' мин':Math.round(s)+' с';
const country=key=>key==='ZZ'?'Не определена':names.of(key)||key;
let days=30, serial=0, mapData, mapProjection;
// --- Переключатель игр (RRaM / YUI): один дашборд, данные каждой игры со своего сервера.
// RRaM — /admin/stats и /admin/data; YUI — /admin/yui-stats и /admin/yui-data (nginx → сервер YUI).
const GAMES={rram:{name:'RRaM',site:'RRaM'},yui:{name:'YUI',site:'yui.com.ru'}};
let game=(()=>{try{const g=localStorage.getItem('admin.game');return GAMES[g]?g:'rram';}catch{return 'rram';}})();
const api=path=>game==='yui'?'/admin/yui-'+path:'/admin/'+path;
function applyGame(){
 const g=GAMES[game];
 platformNames.site=g.site;
 const siteOption=document.querySelector('#platform option[value="site"]');if(siteOption)siteOption.textContent=g.site;
 // площадки у игр разные: YUI есть в Telegram, но нет на CrazyGames
 const select=$('platform');
 if(select){
  let tg=select.querySelector('option[value="telegram"]');
  if(!tg){tg=document.createElement('option');tg.value='telegram';tg.textContent='Telegram';select.querySelector('option[value="local"]')?.before(tg);}
  const hide={telegram:game!=='yui',crazygames:game==='yui'};
  for(const [value,hidden] of Object.entries(hide)){const o=select.querySelector(`option[value="${value}"]`);if(o){o.hidden=hidden;o.disabled=hidden;}}
  if(select.selectedOptions[0]?.disabled)select.value='all';
 }
 const brand=document.querySelector('header .brand');if(brand&&brand.firstChild&&brand.firstChild.nodeType===3)brand.firstChild.nodeValue=g.name+' ';
 document.title=g.name+' · Статистика игры';
 document.querySelectorAll('.game-switch button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.game===game)));
 const pub=document.querySelector('header nav a[href="/admin/publishing"]');if(pub)pub.hidden=game!=='rram';
}
(function(){
 const style=document.createElement('style');
 style.textContent='.game-switch{display:inline-flex;gap:4px;margin-left:18px;margin-right:auto;padding:3px;border:1px solid #243a63;border-radius:10px;vertical-align:middle}'
  +'.game-switch button{background:none;border:0;color:#9fb4d4;font:inherit;font-size:14px;font-weight:600;padding:5px 14px;border-radius:7px;cursor:pointer}'
  +'.game-switch button:hover{color:#dbe4f0}.game-switch button[aria-pressed="true"]{background:#1f7a55;color:#eafff5}';
 document.head.append(style);
 const sw=document.createElement('span');sw.className='game-switch';sw.setAttribute('role','group');sw.setAttribute('aria-label','Игра');
 for(const key of Object.keys(GAMES)){
  const b=document.createElement('button');b.type='button';b.dataset.game=key;b.textContent=GAMES[key].name;
  b.onclick=()=>{if(game===key)return;game=key;try{localStorage.setItem('admin.game',key);}catch{}applyGame();refresh();};
  sw.append(b);
 }
 const brand=document.querySelector('header .brand');if(brand)brand.after(sw);
 applyGame();
})();
async function get(url){const r=await fetch(url,{cache:'no-store'});if(r.status===401){location.href='/admin/login';throw Error('Сессия истекла');}if(!r.ok)throw Error('Сервер не отдал данные ('+r.status+')');return r.json();}
function rows(target,data){const body=$(target);body.replaceChildren();for(const cells of data){const tr=document.createElement('tr');for(const text of cells){const td=document.createElement('td');td.textContent=text;tr.append(td);}body.append(tr);}if(!data.length){const tr=body.insertRow();const cell=tr.insertCell();cell.colSpan=8;cell.className='empty';cell.textContent='За этот период данных пока нет';}}
function metric(label,value,description){const card=document.createElement('article');card.className='metric';for(const [tag,text] of [['div',label],['strong',value],['small',description]]){const node=document.createElement(tag);if(tag==='div')node.className='label';node.textContent=text;card.append(node);}return card;}
function render(d){
 const t=d.totals;
 $('periodDescription').textContent=d.start+' — '+d.end+' · календарные дни, МСК';
 $('metrics').replaceChildren(
  metric('Играли за период',nf.format(t.players),'Уникальные посетители с хотя бы одним игровым действием'),
  metric('Посетители',nf.format(t.visitors),nf.format(t.guests)+' гостей · '+nf.format(t.accounts)+' аккаунтов'),
  metric('Новые / вернувшиеся',nf.format(t.newVisitors)+' / '+nf.format(t.returningVisitors),'Вернувшиеся были замечены до начала выбранного периода'),
  metric('Время в партиях',duration(t.playerSeconds),'Сумма времени открытых вкладок в активных партиях'),
  metric('Начато партий',nf.format(t.matches),nf.format(t.noActions)+' без действий человека'),
  metric('Завершено партий',nf.format(t.completed),t.completionRate==null?'Нет начатых партий':t.completionRate.toFixed(1)+'% от начатых · '+t.forfeits+' сдач'),
  metric('Средняя / медиана партии',duration(t.avgMatchSeconds)+' / '+duration(t.medianMatchSeconds),t.timedMatches+' партий · от начала до конца, включая паузы'),
  metric('Не завершено',nf.format(t.unfinished),t.dormant+' без действий более суток · могут быть продолжены'),
  // звёзды Telegram — только у YUI: сервер присылает поле stars (null — бот не ответил)
  ...('stars' in d?[d.stars?metric('Звёзды Telegram',nf.format(d.stars.period.stars)+' ⭐',nf.format(d.stars.period.payments)+' платежей · '+nf.format(d.stars.period.supporters)+' поддержали · всего '+nf.format(d.stars.total.stars)+' ⭐ от '+nf.format(d.stars.total.supporters)):metric('Звёзды Telegram','—','Бот платежей не ответил, попробуйте обновить')]:[])
 );
 $('coverage').textContent='Точный учёт посетителей, стран и времени ведётся с '+date(d.since)+'. '+(t.historicalMatches? 'В число партий включено '+t.historicalMatches+' старых сохранений; их длительность не восстановлена. ':'')+'Боты не входят в число игроков. Партии с отладочными командами исключены.';
 $('updated').textContent='Обновлено '+date(d.now);
 const max=Math.max(1,...d.trend.map(r=>r.visitors));$('trend').replaceChildren();
 d.trend.forEach((r,i)=>{const col=document.createElement('div');col.className='day';col.tabIndex=0;col.title=r.day+': посетители '+r.visitors+', играли '+r.players+', партий '+r.matches;col.setAttribute('aria-label',col.title);const bars=document.createElement('div');bars.className='bars';for(const [n,cls] of [[r.visitors,'bar'],[r.players,'bar played']]){const bar=document.createElement('div');bar.className=cls;bar.style.height=(n/max*100)+'%';bars.append(bar);}const label=document.createElement('small');label.textContent=i%Math.ceil(d.days/10)===0?r.day.slice(8)+'.'+r.day.slice(5,7):'';col.append(bars,label);$('trend').append(col);});
 rows('dailyRows',d.trend.map(r=>[r.day,r.visitors,r.players,r.matches]));
 rows('countryRows',d.countries.map(r=>[country(r.key),r.visitors,r.players]));
 rows('platformRows',d.platforms.map(r=>[platformNames[r.key]||r.key,r.visitors,r.players,duration(r.seconds)]));
 rows('modeRows',d.modes.map(r=>[modeNames[r.key]||r.key,r.visitors,r.players,duration(r.seconds)]));
 rows('matchRows',d.recent.map(r=>[date(r.started),modeNames[r.mode],{finished:'Завершена',forfeit:'Сдача',unfinished:'Не завершена'}[r.status],duration(r.duration),r.actions,r.errors]));
 renderMap(d);
}
const svgNode=(name,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;};
async function loadMap(){
 const [world,centers]=await Promise.all([get('/admin/assets/world.json'),get('/admin/assets/countries.json')]);
 const land=topojson.feature(world,world.objects.countries);
 land.features=land.features.filter(feature=>Number(feature.id)!==10);
 // Spherical clipping handles countries crossing the antimeridian (Russia, Fiji).
 mapProjection=d3.geoNaturalEarth1().fitExtent([[12,12],[988,488]],land);
 const path=d3.geoPath(mapProjection);
 $('land').replaceChildren(...land.features.map(feature=>svgNode('path',{d:path(feature)})));
 return centers;
}
function renderMap(d){
 $('dots').replaceChildren();let located=0;const max=Math.max(1,...d.countries.map(r=>r.visitors));
 if(mapData)for(const r of d.countries){const p=mapData[r.key];if(!p)continue;located++;const [x,y]=mapProjection([p.lon,p.lat]);const circle=svgNode('circle',{cx:x,cy:y,r:4+14*Math.sqrt(r.visitors/max),tabindex:0,'aria-label':country(r.key)+': '+r.visitors+' посетителей'});const title=svgNode('title',{});title.textContent=country(r.key)+': '+r.visitors+' посетителей, играли '+r.players;circle.append(title);$('dots').append(circle);}
 $('countryCount').textContent=located+' стран';
 const unknown=d.countries.find(r=>r.key==='ZZ')?.visitors||0;
 $('mapStatus').textContent=!mapData?'Не удалось загрузить карту. Числа доступны в таблице стран.':!d.geo.available?'База стран не загружена; география недоступна.':!d.countries.length?'Точки появятся после первых посещений. Исторические страны не восстанавливаются.':'Не определена страна у '+unknown+' посетителей. Наведите на точку, чтобы увидеть число.';
}
async function diagnostics(){
 if(!$('diagnostics').open)return;
 const d=await get(api('data'));$('serverInfo').textContent='Сервер '+d.serverVersion+' · работает '+duration(d.uptimeSec)+' · подключений '+d.counts.clients+' · комнат '+d.counts.rooms+' · играют сейчас '+d.counts.playing+' · сохранений без игроков онлайн '+d.counts.saved+' · ожидают соперника '+d.counts.waitingOnline+' · пустых ожиданий '+d.counts.waitingOffline;
 rows('clientRows',d.clients.map(c=>[c.name||'Гость',c.device,c.state,c.roomCode||'—',duration(c.connectedSec),c.rtt==null?'—':c.rtt+' мс',c.version]));
 rows('roomRows',d.rooms.map(r=>[r.code,date(r.startedAt||r.createdAt),r.players.map(p=>(p.name||'?')+(p.isBot?' (ИИ)':'')).join(', '),r.game ? (r.players.some(p=>!p.isBot&&p.connected)?'Идёт · есть игроки онлайн':'Сохранение · все отключены') : (r.players.some(p=>!p.isBot&&p.connected)?'Ждёт соперника':'Пустая · закрытие '+date((r.emptySince||d.now)+3600000)),'']));
 d.rooms.forEach((r,i)=>{if(r.status==='active'&&r.type==='public'&&r.game&&!r.game.over){const a=document.createElement('a');a.href='/?watch='+encodeURIComponent(r.code);a.target='_blank';a.rel='noopener';a.textContent='Смотреть';$('roomRows').rows[i].lastChild.append(a);}});
}
async function refresh(){const seq=++serial;$('refresh').disabled=true;$('error').hidden=true;try{const d=await get(api('stats')+'?'+new URLSearchParams({days,platform:$('platform').value,mode:$('mode').value}));if(seq!==serial)return;render(d);await diagnostics();}catch(e){if(seq===serial){$('error').hidden=false;$('error').textContent='Не удалось обновить статистику. '+e.message;}}finally{if(seq===serial)$('refresh').disabled=false;}}
document.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{days=Number(b.dataset.days);document.querySelectorAll('[data-days]').forEach(x=>x.setAttribute('aria-pressed',x===b));refresh();});
$('platform').onchange=$('mode').onchange=$('refresh').onclick=refresh;
$('diagnostics').ontoggle=()=>diagnostics().catch(e=>{$('serverInfo').textContent=e.message;});
loadMap().then(data=>{mapData=data;refresh();}).catch(()=>refresh());
