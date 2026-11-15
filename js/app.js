import { createMap, drawRoute, startLocationTracking, removeMap } from './map.js';
import { getTheme, setTheme, saveRating, getVisitedPlaces, saveVisitedPlace } from './storage.js';
import { getPedestrianRoute } from './routing.js';

const $ = (id) => document.getElementById(id);
const screenIds = ['homeScreen','previewScreen','activeScreen','finishScreen'];
let routes = [], places = [], selectedRoute = null, activeTracker = null, visited = new Set(), currentFact = null, visibleRoutes = [], featuredIndex = 0, activeFilter = 'all';

function showScreen(id) {
  screenIds.forEach(screenId => { $(screenId).hidden = screenId !== id; });
  $('bottomNav').hidden = id === 'previewScreen' || id === 'finishScreen';
  setNavActive(id === 'activeScreen' ? 'navWalk' : 'navHome');
  window.scrollTo({top:0,behavior:'smooth'});
}
function setNavActive(id) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.id === id));
}
function updateFeatured(route) {
  if (!route) return;
  $('featuredTitle').textContent = route.title;
  $('featuredDescription').textContent = route.description;
  $('featuredArt').style.backgroundImage = 'url("' + (route.image || 'assets/images/historic-center.svg') + '")';
  $('featuredMeta').replaceChildren();
  [route.category, '◷ ' + route.duration + ' мин', '↗ ' + route.distance + ' км'].forEach((value,index) => {
    const pill=document.createElement('span'); pill.className='meta-pill'+(index===0?' station':''); pill.textContent=value; $('featuredMeta').append(pill);
  });
  $('featuredRoute').onclick = () => openPreview(route);
  $('featuredStart').onclick = () => openPreview(route);
}
function applyRouteFilter(filter) {
  activeFilter=filter;
  document.querySelectorAll('.filter-chip').forEach(chip=>chip.classList.toggle('active',chip.dataset.filter===filter));
  const filtered=filter==='all'?visibleRoutes:visibleRoutes.filter(route=>route.category===filter || (filter==='Природа' && /природ|пар|вид/i.test(route.category)));
  renderRoutes(filtered);
}
function distanceMeters(a,b) {
  const rad=x=>x*Math.PI/180, R=6371000;
  const dLat=rad(b[0]-a[0]), dLon=rad(b[1]-a[1]);
  const x=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function getVisitMinutes(place) {
  if (Number.isFinite(place.visitMinutes)) return place.visitMinutes;
  const tags=place.tags||[];
  if (tags.includes('museum') || place.category==='Музеи') return 30;
  if (tags.includes('nature') || tags.includes('quiet')) return 15;
  if (tags.includes('church') || /церк|храм|монастыр/i.test(place.name)) return 12;
  if (tags.includes('memorial') || tags.includes('monument') || /памятник/i.test(place.name)) return 8;
  if (tags.includes('architecture') || tags.includes('history')) return 7;
  return 8;
}
function getRouteVisitMinutes(stops) {
  return stops.reduce((sum,stop)=>sum+getVisitMinutes(stop),0);
}
function getPlaceInterest(place) {
  const tags=place.tags||[];
  let score=2;
  if(tags.includes('hidden')) score+=1.2;
  if(tags.includes('culture')||tags.includes('views')||tags.includes('nature')) score+=1;
  if(tags.includes('museum')||tags.includes('literature')||tags.includes('memorial')) score+=0.8;
  if(tags.includes('history')||tags.includes('architecture')) score+=0.4;
  return Math.min(5,score);
}
function buildCandidate(pool,maxStops,variant) {
  const shuffled=[...pool].sort(()=>Math.random()-.5);
  const starts=[...shuffled].sort((a,b)=>{
    const ax=a.coordinates[0], ay=a.coordinates[1], bx=b.coordinates[0], by=b.coordinates[1];
    return (Math.sin((ax+variant)*12.9898)+Math.cos((ay+variant)*78.233))-(Math.sin((bx+variant)*12.9898)+Math.cos((by+variant)*78.233));
  });
  const chosen=[starts[variant%starts.length]];
  let remaining=shuffled.filter(place=>place.id!==chosen[0].id);
  while(remaining.length&&chosen.length<maxStops) {
    const last=chosen[chosen.length-1];
    const counts={};
    chosen.forEach(place=>(counts[place.category]=(counts[place.category]||0)+1));
    remaining.sort((a,b)=>{
      const rank=place=>{
        const km=distanceMeters(last.coordinates,place.coordinates)/1000;
        const repeated=(counts[place.category]||0)*0.9;
        const parkBias=place.tags?.includes('nature')||place.tags?.includes('quiet')? -0.15:0;
        return km+repeated+parkBias;
      };
      return rank(a)-rank(b);
    });
    const shortlist=remaining.slice(0,Math.min(4,remaining.length));
    const next=shortlist[(variant+chosen.length)%shortlist.length];
    chosen.push(next);
    remaining=remaining.filter(place=>place.id!==next.id);
  }
  return chosen;
}
function scoreCandidate(candidate,routed,totalMinutes,limit) {
  const categories=new Set(candidate.map(place=>place.category));
  const diversity=25*Math.min(1,categories.size/Math.min(3,candidate.length));
  const interest=25*(candidate.reduce((sum,place)=>sum+getPlaceInterest(place),0)/candidate.length/5);
  const hiddenShare=candidate.filter(place=>(place.tags||[]).includes('hidden')).length/candidate.length;
  const novelty=15*hiddenShare;
  let straightDistance=0;
  for(let i=1;i<candidate.length;i++) straightDistance+=distanceMeters(candidate[i-1].coordinates,candidate[i].coordinates);
  const roadDistance=Math.max(1,routed.distanceKm*1000);
  const compactness=20*Math.max(0,Math.min(1,straightDistance/roadDistance));
  const targetMinutes=limit*0.8;
  const timeFit=15*Math.max(0,1-Math.abs(totalMinutes-targetMinutes)/targetMinutes);
  return diversity+interest+novelty+compactness+timeFit;
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
  visibleRoutes=[...routes];
  renderRoutes(visibleRoutes);
  featuredIndex=0; updateFeatured(routes[0]);
}
function updateDiscoveryHint(){
  const found=getVisitedPlaces().length;
  $('discoveryHint').textContent=`Открыто ${found} из ${places.length}. Отмечай точки во время прогулок — Novera будет учитывать их в следующих подборках.`;
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
    if(mood==='culture') return p.tags.includes('culture')||p.tags.includes('literature');
    if(mood==='nature') return p.tags.includes('nature')||p.tags.includes('quiet')||p.tags.includes('waterfront');
    if(mood==='views') return p.tags.includes('views')||p.tags.includes('waterfront');
    return true;
  });
  if(pool.length<2){
    $('routeList').textContent=onlyNew?'В этой категории пока осталось меньше двух неоткрытых мест. Сними галочку или выбери другую тему.':'Пока недостаточно точек для такой прогулки.';
    $('routeCount').textContent='0 маршрутов';return;
  }
  button.disabled=true;
  button.textContent='Сравниваем варианты прогулки…';
  $('routeList').innerHTML='<p class="muted">Подбираем разные варианты и рассчитываем пешеходные дорожки. Это может занять несколько секунд.</p>';
  try {
    let best=null;
    const maxPossible=Math.min(pool.length,limit<45?2:limit<75?3:limit<120?4:5);
    const stopCounts=[maxPossible,Math.max(2,maxPossible-1),Math.max(2,maxPossible-2)].filter((v,i,a)=>a.indexOf(v)===i);
    const candidates=[];
    for(let i=0;i<5;i++) {
      const count=stopCounts[i%stopCounts.length];
      const candidate=buildCandidate(pool,count,i);
      if(candidate.length>=2)candidates.push(candidate);
    }
    for(const candidate of candidates) {
      let current=[...candidate];
      while(current.length>=2) {
        const routed=await getPedestrianRoute(current);
        const visitMinutes=getRouteVisitMinutes(current);
        const bufferMinutes=5;
        const totalMinutes=routed.travelMinutes+visitMinutes+bufferMinutes;
        if(totalMinutes<=limit) {
          const score=scoreCandidate(current,routed,totalMinutes,limit);
          if(!best||score>best.score) best={chosen:current,routed,duration:totalMinutes,visitMinutes,bufferMinutes,score};
          break;
        }
        if(current.length<=2)break;
        current.pop();
      }
    }
    if(!best){
      $('routeList').innerHTML='<p class="muted">Не удалось собрать маршрут в выбранное время. Попробуй увеличить лимит или снять галочку «Только ещё не открытые места».</p>';
      $('routeCount').textContent='0 маршрутов';return;
    }
    const stops=best.chosen.map(p=>({...p,visitMinutes:getVisitMinutes(p),radius:65,fact:p.fact}));
    const route={
      id:`generated-${Date.now()}`,title:generatedTitle(mood),
      subtitle:'Маршрут построен по пешеходной сети OpenStreetMap',
      description:`В прогулке ${best.chosen.length} остановки. Около ${best.routed.travelMinutes} минут ходьбы, ${best.visitMinutes} минут на осмотр и 5 минут запаса.`,
      duration:best.duration,distance:Number(best.routed.distanceKm.toFixed(1)),
      difficulty:best.routed.distanceKm>4?'Средний':'Лёгкий',
      category:moodLabel(mood),image:'assets/images/historic-center.svg',
      start:{name:stops[0].name,coordinates:stops[0].coordinates},
      finish:{name:stops[stops.length-1].name,coordinates:stops[stops.length-1].coordinates},
      stops,coordinates:stops.map(s=>s.coordinates),geometry:best.routed.geometry,
      instructions:best.routed.instructions,generated:true,routing:'valhalla',
      bufferMinutes:best.bufferMinutes,selectionScore:Number(best.score.toFixed(1))
    };
    visibleRoutes=[route,...routes.filter(r=>r.duration<=limit)];
    applyRouteFilter('all');
    updateFeatured(route);
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
      const routed=route.geometry?{geometry:route.geometry,distanceKm:route.distance,travelMinutes:Math.max(0,route.duration-getRouteVisitMinutes(route.stops)-(route.bufferMinutes||0)),instructions:route.instructions||[]}:await getPedestrianRoute(route.stops);
      if(selectedRoute.id!==route.id) return;
      selectedRoute={...selectedRoute,...routed,routing:'valhalla',distance:Number(routed.distanceKm.toFixed(1)),duration:routed.travelMinutes+getRouteVisitMinutes(route.stops)+(route.bufferMinutes||0)};
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
  document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#0b0b0b':'#f4f4f2';
  setTheme(theme);
}
function speakFact() {
  if(!currentFact || !('speechSynthesis' in window)){alert('Озвучивание не поддерживается этим браузером.');return;}
  window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(`${currentFact.name}. ${currentFact.fact}`);
  utterance.lang='ru-RU'; window.speechSynthesis.speak(utterance);
}
$('generateWalk').addEventListener('click',generateWalk);
document.querySelectorAll('.filter-chip').forEach(chip=>chip.addEventListener('click',()=>applyRouteFilter(chip.dataset.filter)));
$('refreshFeatured').addEventListener('click',()=>{
  if(!routes.length)return;
  featuredIndex=(featuredIndex+1)%routes.length;
  updateFeatured(routes[featuredIndex]);
});
$('modeAtmosphere').addEventListener('click',()=>{
  $('modeAtmosphere').classList.add('active');$('modeExcursions').classList.remove('active');
  $('moodSelect').value='surprise';
});
$('modeExcursions').addEventListener('click',()=>{
  $('modeExcursions').classList.add('active');$('modeAtmosphere').classList.remove('active');
  $('moodSelect').value='architecture';
});
$('navHome').addEventListener('click',()=>{if(activeTracker){activeTracker.stop();activeTracker=null;}removeMap('activeMap');removeMap('previewMap');showScreen('homeScreen');});
$('navMap').addEventListener('click',()=>{showScreen('homeScreen');$('allRoutes').scrollIntoView({behavior:'smooth'});});
$('navWalk').addEventListener('click',()=>{if(selectedRoute && selectedRoute.geometry)startWalk();else $('generatorPanel').scrollIntoView({behavior:'smooth'});});
$('navProfile').addEventListener('click',()=>{
  $('profileDiscovery').textContent=getVisitedPlaces().length+' мест открыто';
  $('profilePopover').hidden=false;
});
$('profileClose').addEventListener('click',()=>$('profilePopover').hidden=true);
$('backToHome').addEventListener('click',()=>{removeMap('previewMap');showScreen('homeScreen');});
$('homeLink').addEventListener('click',e=>{e.preventDefault();if(activeTracker){activeTracker.stop();activeTracker=null;}removeMap('previewMap');removeMap('activeMap');showScreen('homeScreen');});
$('startWalk').addEventListener('click',startWalk);
$('finishWalk').addEventListener('click',finishWalk);
$('exitWalk').addEventListener('click',()=>{if(activeTracker){activeTracker.stop();activeTracker=null;}removeMap('activeMap');showScreen('homeScreen');});
$('finishHome').addEventListener('click',()=>{showScreen('homeScreen');visibleRoutes=[...routes];applyRouteFilter('all');});
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
