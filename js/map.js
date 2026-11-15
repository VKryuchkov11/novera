const VORONEZH_CENTER=[51.660781,39.200296];
const instances={};

export function createMap(elementId){
  if(instances[elementId]) instances[elementId].remove();
  const map=L.map(elementId,{scrollWheelZoom:false,attributionControl:false,zoomControl:false}).setView(VORONEZH_CENTER,14);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.attribution({prefix:false,position:'bottomleft'}).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
    subdomains:'abcd',
    maxZoom:20,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);
  instances[elementId]=map;
  setTimeout(()=>map.invalidateSize(),100);
  return map;
}

function markerIcon(type,label){
  const className=type==='stop'?'novera-map-marker novera-map-stop':`novera-map-marker novera-map-${type}`;
  return L.divIcon({
    className,
    html:`<span>${escapeHtml(label)}</span>`,
    iconSize:type==='stop'?[32,32]:[36,36],
    iconAnchor:type==='stop'?[16,16]:[18,18]
  });
}

export function drawRoute(map,route){
  const bounds=[];
  const geometry=Array.isArray(route.geometry)?route.geometry:[];
  if(geometry.length>1){
    // Тёмная подложка под линией повышает контраст на сложных участках карты.
    L.polyline(geometry,{color:'#080808',weight:10,opacity:.9,lineCap:'round',lineJoin:'round'}).addTo(map);
    L.polyline(geometry,{color:'#e52b38',weight:5,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(map);
    bounds.push(...geometry);
  }

  const stops=Array.isArray(route.stops)?route.stops:[];
  stops.forEach((stop,index)=>{
    if(!Array.isArray(stop.coordinates)) return;
    bounds.push(stop.coordinates);
    L.marker(stop.coordinates,{icon:markerIcon('stop',String(index+1)),keyboard:true,title:`${index+1}. ${stop.name}`})
      .addTo(map)
      .bindPopup(`<strong>${index+1}. ${escapeHtml(stop.name)}</strong><br>${escapeHtml(stop.description||'')}`);
  });

  const start=route.start?.coordinates || stops[0]?.coordinates;
  const finish=route.finish?.coordinates || stops[stops.length-1]?.coordinates;
  if(start){
    bounds.push(start);
    L.marker(start,{icon:markerIcon('start','S'),keyboard:true,title:'Старт'})
      .addTo(map).bindPopup(`<strong>Старт:</strong> ${escapeHtml(route.start?.name||stops[0]?.name||'Начало маршрута')}`);
  }
  if(finish && (!start || finish[0]!==start[0] || finish[1]!==start[1])){
    bounds.push(finish);
    L.marker(finish,{icon:markerIcon('finish','F'),keyboard:true,title:'Финиш'})
      .addTo(map).bindPopup(`<strong>Финиш:</strong> ${escapeHtml(route.finish?.name||stops[stops.length-1]?.name||'Конец маршрута')}`);
  }
  if(bounds.length){
    map.fitBounds(L.latLngBounds(bounds),{padding:[38,38],maxZoom:16});
  }
}

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function startLocationTracking(map,onUpdate){
  const userMarker=L.circleMarker(VORONEZH_CENTER,{radius:8,color:'#fff',weight:3,fillColor:'#438bd0',fillOpacity:1}).addTo(map);
  const path=L.polyline([],{color:'#438bd0',weight:4}).addTo(map);
  const points=[]; let accuracyCircle=null; let firstFix=true;
  const watchId=navigator.geolocation.watchPosition(position=>{
    const coordinates=[position.coords.latitude,position.coords.longitude];
    points.push(coordinates); path.setLatLngs(points); userMarker.setLatLng(coordinates);
    if(accuracyCircle) accuracyCircle.remove();
    accuracyCircle=L.circle(coordinates,{radius:position.coords.accuracy,color:'#438bd0',opacity:.25,fillOpacity:.04}).addTo(map);
    if(firstFix){map.setView(coordinates,16);firstFix=false;}
    onUpdate({coordinates,accuracy:position.coords.accuracy});
  },error=>{
    const messages={1:'Доступ к геолокации запрещён. Разреши его в настройках браузера.',2:'Не удалось определить местоположение.',3:'Истекло время ожидания GPS.'};
    const status=document.getElementById('gpsStatus'); if(status) status.textContent=messages[error.code]||error.message;
  },{enableHighAccuracy:true,maximumAge:3000,timeout:20000});
  return {stop(){navigator.geolocation.clearWatch(watchId);}};
}
export function removeMap(elementId){if(instances[elementId]){instances[elementId].remove();delete instances[elementId];}}
