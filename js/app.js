import { createMap, drawRoute, startLocationTracking, removeMap } from './map.js';
import { getTheme, setTheme, saveRating, getVisitedPlaces, saveVisitedPlace } from './storage.js';
import { getPedestrianRoute } from './routing.js';

const $ = (id) => document.getElementById(id);
const screenIds = ['homeScreen','previewScreen','activeScreen','finishScreen'];
let routes = [], places = [], selectedRoute = null, activeTracker = null, visited = new Set(), currentFact = null;

function showScreen(id) {
  screenIds.forEach(screenId => { $(screenId).hidden = screenId !== id; });
  window.scrollTo({top:0,behavior:'smooth'});
}
function distanceMeters(a,b) {
  const rad=x=>x*Math.PI/180, R=6371000;
  const dLat=rad(b[0]-a[0]), dLon=rad(b[1]-a[1]);
  const x=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
async function loadData() {
  const [routeResponse,placesResponse]=await Promise.all([
    fetch('./data/routes.json'), fetch('./data/places.json')
  ]);
  if(!routeResponse.ok || !placesResponse.ok) throw new Error('Не удалось загрузить базу прогулок');
  const routeData=await routeResponse.json(), placeData=await placesResponse.json();
  routes=routeData.routes; places=placeData.places;
  $('discoveryCount').textContent=`${places.length} мест для открытий`;
  updateDiscoveryHint();
  renderRoutes(routes);
}
function updateDiscoveryHint(){
  const found=getVisitedPlaces().length;
  $('discoveryHint').textContent=`Открыто ${found} из ${places.length}. Отмечай точки во время прогулок — Wayer будет учитывать их в следующих подборках.`;
}
function renderRoutes(items) {
  $('routeCount').textContent = `${items.length} ${items.length === 1 ? 'маршрут' : 'маршрутов'}`;
  const list = $('routeList');
  if (!items.length) {
    list.innerHTML = '<p class="muted">Не получилось собрать прогулку с такими параметрами. Увеличь время или выбери другую тему.</p>';
    return;
  }
  list.replaceChildren(...items.map(route => {
    const card = document.createElement('article');
    card.className = 'route-card';
    card.tabIndex = 0;
    card.setAttribute('role','button');
    card.setAttribute('aria-label',`Открыть маршрут ${route.title}`);
    const art = document.createElement('div');
    art.className = 'route-art';
    art.style.backgroundImage = `url("${route.image || 'assets/images/historic-center.svg'}")`;
    const content = document.createElement('div');
    content.className = 'route-content';
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = route.category;
    const title = document.createElement('h3'); title.textContent = route.title;
    const description = document.createElement('p'); description.textContent = route.description;
    const meta = document.createElement('div'); meta.className = 'route-meta';
    const duration = document.createElement('span'); duration.textContent = `◷ около ${route.duration} мин`;
    const distance = document.createElement('span'); distance.textContent = `↗ ${route.distance} км`;
    meta.append(duration,distance); content.append(tag,title,description,meta); card.append(art,content);
    card.addEventListener('click', () => openPreview(route));
    card.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreview(route); }});
    return card;
  }));
}
async function generateWalk(){
  const button=$('generateWalk');
  const limit=Number($('timeInput').value);
  if(!Number.isFinite(limit)||limit<20||limit>360){alert('Укажи время от 20 до 360 минут.');return;}
  const mood=$('moodSelect').value;
  const onlyNew=$('newOnly').checked;
  const known=new Set(getVisitedPlaces());
  const pool=places.filter(p=>{
    if(onlyNew&&known.has(p.id)) return false;
    if(mood==='surprise') return true;
    if(mood==='hidden') return p.tags.includes('hidden');
    if(mood==='architecture') return p.tags.includes('architecture')||p.tags.includes('history');
    if(mood==='culture') return p.tags.includes('culture');
    if(mood==='nature') return p.tags.includes('nature')||p.tags.includes('quiet');
    if(mood==='views') return p.tags.includes('views');
    return true;
  });
  if(pool.length<2){
    $('routeList').textContent=onlyNew?'Похоже, ты уже открыл почти все места этой категории. Сними галочку или выбери другую тему.':'Пока недостаточно точек для такой прогулки.';
    $('routeCount').textContent='0 маршрутов';return;
  }

  button.disabled=true;
  button.textContent='Строим пешеходный маршрут…';
  $('routeList').innerHTML='<p class="muted">Подбираем точки и рассчитываем путь по пешеходным дорожкам. Это может занять несколько секунд.</p>';
  try {
    // Начальная последовательность — эвристика по расстоянию между точками.
    // Фактическое расстояние и время затем берём только из пешеходного роутера.
    let best=null;
    const tries=Math.min(2,pool.length);
    for(let t=0;t<tries;t++){
      const shuffled=[...pool].sort(()=>Math.random()-.5);
      const chosen=[shuffled[0]];
      let remaining=shuffled.slice(1);
      while(remaining.length&&chosen.length<5){
        const last=chosen[chosen.length-1];
        remaining.sort((a,b)=>distanceMeters(last.coordinates,a.coordinates)-distanceMeters(last.coordinates,b.coordinates));
        chosen.push(remaining.shift());
      }
      let candidate=[...chosen];
      let routed=null;
      while(candidate.length>=2){
        routed=await getPedestrianRoute(candidate);
        const visitMinutes=candidate.length*5;
        const totalMinutes=routed.travelMinutes+visitMinutes;
        if(totalMinutes<=limit) break;
        candidate.pop();
        routed=null;
      }
      if(routed){
        const totalMinutes=routed.travelMinutes+candidate.length*5;
        const score=totalMinutes;
        if(!best||score>best.duration) best={chosen:candidate,routed,duration:totalMinutes};
      }
      // Достаточно первого подходящего варианта, чтобы не нагружать публичный сервер.
      if(best) break;
    }
    if(!best){
      $('routeList').innerHTML='<p class="muted">Не удалось построить пешеходный маршрут в заданное время. Попробуй увеличить лимит или выбрать другую тему.</p>';
      $('routeCount').textContent='0 маршрутов';return;
    }
    const stops=best.chosen.map(p=>({...p,radius:65,fact:p.fact}));
    const route={
      id:`generated-${Date.now()}`,
      title:generatedTitle(mood),
      subtitle:'Маршрут построен по пешеходной сети OpenStreetMap',
      description:`Прогулка по ${best.chosen.length} точкам. Путь рассчитан пешеходным маршрутизатором; время включает примерно 5 минут на каждую остановку.`,
      duration:best.duration,distance:Number(best.routed.distanceKm.toFixed(1)),
      difficulty:best.routed.distanceKm>4?'Средний':'Лёгкий',
      category:moodLabel(mood),image:'assets/images/historic-center.svg',
      start:{name:stops[0].name,coordinates:stops[0].coordinates},
      finish:{name:stops[stops.length-1].name,coordinates:stops[stops.length-1].coordinates},
      stops,coordinates:stops.map(s=>s.coordinates),geometry:best.routed.geometry,
      instructions:best.routed.instructions,generated:true,routing:'valhalla'
    };
    renderRoutes([route,...routes.filter(r=>r.duration<=limit).slice(0,2)]);
  } catch(error) {
    console.error('Pedestrian route generation failed:',error);
    $('routeList').innerHTML=`<p class="muted">${escapeHtmlText(error.message)} Готовые маршруты можно открыть, но их линия тоже будет показана только после успешного расчёта.</p>`;
    $('routeCount').textContent='Маршрут не построен';
  } finally {
    button.disabled=false;
    button.innerHTML='Сгенерировать прогулку <span aria-hidden="true">→</span>';
  }
}
function escapeHtmlText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function generatedTitle(mood){
  const titles={surprise:['Неизведанный Воронеж','Городской экспромт','Маршрут открытий'],hidden:['Тайные адреса Воронежа','В стороне от туристических троп','Неочевидный центр'],architecture:['Архитектурные детали','Следы старого города','Воронеж в кирпиче и камне'],culture:['Литературные адреса','Культурный маршрут','Город писателей'],nature:['Зелёная передышка','Тихие уголки города','Город и природа'],views:['К воде и красивым видам','Городские панорамы','Воронеж у воды']};
  const list=titles[mood]||titles.surprise;return list[Math.floor(Math.random()*list.length)];
}
function moodLabel(mood){return ({surprise:'Открытия',hidden:'Малоизвестные места',architecture:'Архитектура',culture:'Культура',nature:'Природа',views:'Виды'})[mood]||'Открытия';}
async function openPreview(route) {
  selectedRoute = {...route};
  $('previewDetails').replaceChildren();
  const head = document.createElement('div'); head.className = 'detail-head';
  const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = route.category;
  const title = document.createElement('h1'); title.textContent = route.title;
  const subtitle = document.createElement('p'); subtitle.textContent = route.subtitle;
  const description = document.createElement('p'); description.textContent = route.description;
  const meta = document.createElement('div'); meta.className = 'route-meta';
  meta.textContent = `◷ около ${route.duration} минут   ·   ↗ ${route.distance} км   ·   ${route.difficulty}`;
  head.append(tag,title,subtitle,description,meta); $('previewDetails').append(head);
  $('poiList').replaceChildren(...route.stops.map(stop => { const li=document.createElement('li'); li.textContent=stop.name; return li; }));
  $('startWalk').disabled=true;
  $('routingStatus').dataset.state='loading';
  $('routingStatus').textContent='Строим пешеходный путь по улицам и дорожкам…';
  $('routingInstructions').hidden=true;
  showScreen('previewScreen');
  setTimeout(async () => {
    const map=createMap('previewMap');
    try {
      const routed=route.geometry?{geometry:route.geometry,distanceKm:route.distance,travelMinutes:Math.max(0,route.duration-route.stops.length*5),instructions:route.instructions||[]}:await getPedestrianRoute(route.stops);
      if(selectedRoute.id!==route.id) return;
      selectedRoute={...selectedRoute,...routed,routing:'valhalla',distance:Number(routed.distanceKm.toFixed(1)),duration:routed.travelMinutes+route.stops.length*5};
      drawRoute(map,selectedRoute);
      $('routingStatus').dataset.state='success';
      $('startWalk').disabled=false;
      $('routingStatus').textContent=`Пешеходный маршрут рассчитан: ${selectedRoute.distance} км, примерно ${selectedRoute.duration} мин с учётом остановок. Переходы и доступность конкретных проходов всё равно проверяй на месте.`;
      const updatedMeta=$('previewDetails').querySelector('.route-meta');
      if(updatedMeta) updatedMeta.textContent=`◷ около ${selectedRoute.duration} минут   ·   ↗ ${selectedRoute.distance} км   ·   ${selectedRoute.difficulty}`;
      if(selectedRoute.instructions?.length){
        $('instructionList').replaceChildren(...selectedRoute.instructions.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
        $('routingInstructions').hidden=false;
      }
    } catch(error) {
      console.error('Route preview failed:',error);
      drawRoute(map,{...route,geometry:null});
      $('routingStatus').dataset.state='error';
      $('startWalk').disabled=true;
      $('routingStatus').textContent=`Не удалось рассчитать пешеходный путь: ${error.message} На карте показаны только точки остановок — линии маршрута нет. Попробуй обновить предпросмотр позже.`;
    }
  },100);
}

function startWalk() {
  if (!selectedRoute?.geometry?.length) { alert('Сначала дождись расчёта пешеходного маршрута.'); return; }
  if (!navigator.geolocation) { alert('Этот браузер не поддерживает геолокацию.'); return; }
  visited = new Set(); currentFact = null; $('factCard').hidden = true;
  $('progressFill').style.width='0%'; $('progressPercent').textContent='0%';
  $('progressLabel').textContent=`Посещено 0 из ${selectedRoute.stops.length} точек`;
  $('gpsStatus').textContent='Запрашиваем разрешение на геолокацию…';
  $('activeTitle').textContent=selectedRoute.title;
  showScreen('activeScreen');
  setTimeout(() => {
    const map=createMap('activeMap');
    drawRoute(map,selectedRoute);
    activeTracker=startLocationTracking(map, position => onPosition(position));
  },100);
}
function onPosition(position) {
  $('gpsStatus').textContent=`GPS: точность около ${Math.round(position.accuracy)} м`;
  for (const stop of selectedRoute.stops) {
    if (visited.has(stop.id)) continue;
    const distance=distanceMeters(position.coordinates,stop.coordinates);
    if (position.accuracy <= Math.max(60,stop.radius) && distance <= stop.radius) {
      visited.add(stop.id); showFact(stop); updateProgress();
      if(places.some(p=>p.id===stop.id)){saveVisitedPlace(stop.id);updateDiscoveryHint();}
    }
  }
}
function showFact(stop) {
  currentFact=stop;
  $('factTitle').textContent=stop.name;
  $('factText').textContent=stop.fact;
  $('factCard').hidden=false;
  $('factCard').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function updateProgress() {
  const percent=Math.round(visited.size/selectedRoute.stops.length*100);
  $('progressFill').style.width=`${percent}%`;
  $('progressPercent').textContent=`${percent}%`;
  $('progressLabel').textContent=`Посещено ${visited.size} из ${selectedRoute.stops.length} точек`;
}
function finishWalk() {
  if(activeTracker){activeTracker.stop();activeTracker=null;}
  removeMap('activeMap');
  $('finishSummary').textContent=`«${selectedRoute.title}». Ты отметил ${visited.size} из ${selectedRoute.stops.length} точек маршрута.`;
  $('ratingSaved').textContent='';
  document.querySelectorAll('[data-rating]').forEach(b=>b.classList.remove('active'));
  showScreen('finishScreen');
}
function applyTheme(theme) {
  document.documentElement.dataset.theme=theme;
  $('themeToggle').textContent=theme==='dark'?'☼':'◐';
  document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#191c18':'#f5f4ef';
  setTheme(theme);
}
function speakFact() {
  if(!currentFact || !('speechSynthesis' in window)){alert('Озвучивание не поддерживается этим браузером.');return;}
  window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(`${currentFact.name}. ${currentFact.fact}`);
  utterance.lang='ru-RU'; window.speechSynthesis.speak(utterance);
}
$('generateWalk').addEventListener('click',generateWalk);
$('showAllRoutes').addEventListener('click',()=>renderRoutes(routes));
$('backToHome').addEventListener('click',()=>{removeMap('previewMap');showScreen('homeScreen');});
$('homeLink').addEventListener('click',e=>{e.preventDefault();if(activeTracker){activeTracker.stop();activeTracker=null;}removeMap('previewMap');removeMap('activeMap');showScreen('homeScreen');});
$('startWalk').addEventListener('click',startWalk);
$('finishWalk').addEventListener('click',finishWalk);
$('exitWalk').addEventListener('click',()=>{if(activeTracker){activeTracker.stop();activeTracker=null;}removeMap('activeMap');showScreen('homeScreen');});
$('finishHome').addEventListener('click',()=>{showScreen('homeScreen');renderRoutes(routes);});
$('themeToggle').addEventListener('click',()=>applyTheme(getTheme()==='dark'?'light':'dark'));
$('speakFact').addEventListener('click',speakFact);
document.querySelectorAll('[data-rating]').forEach(button=>button.addEventListener('click',()=>{
  const rating=Number(button.dataset.rating); saveRating(selectedRoute.id,rating);
  document.querySelectorAll('[data-rating]').forEach(b=>b.classList.toggle('active',Number(b.dataset.rating)<=rating));
  $('ratingSaved').textContent='Спасибо за оценку!';
}));

let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;$('installBtn').hidden=false;});
$('installBtn').addEventListener('click',async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('installBtn').hidden=true;});
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(err=>console.warn('SW registration failed',err)));
}
applyTheme(getTheme());
loadData().catch(err=>{console.error(err);$('routeList').textContent='Не удалось загрузить данные. Запусти проект через локальный сервер.';});
