const VORONEZH_CENTER=[51.660781,39.200296];
const instances={};
export function createMap(elementId){
  if(instances[elementId]) instances[elementId].remove();
  const map=L.map(elementId,{scrollWheelZoom:false,attributionControl:false}).setView(VORONEZH_CENTER,14);
  L.control.attribution({prefix:false}).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  instances[elementId]=map;
  setTimeout(()=>map.invalidateSize(),80);
  return map;
}
export function drawRoute(map,route){
  const points=[];
  if(route.geometry && route.geometry.length>1){
    const line=L.polyline(route.geometry,{color:'#e52b38',weight:5,opacity:.96,lineCap:'round',lineJoin:'round'}).addTo(map);
    points.push(...route.geometry);
  }
  (route.stops||[]).forEach((stop,index)=>{
    points.push(stop.coordinates);
    L.marker(stop.coordinates,{icon:L.divIcon({className:'novera-marker',html:'<span>'+(index+1)+'</span>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(map).bindPopup(`<strong>${index+1}. ${escapeHtml(stop.name)}</strong><br>${escapeHtml(stop.description||'')}`);
  });
  if(route.start?.coordinates){
    points.push(route.start.coordinates);
    L.marker(route.start.coordinates,{icon:L.divIcon({className:'novera-marker novera-marker-start',html:'<span>↗</span>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map).bindPopup(`<strong>Старт:</strong> ${escapeHtml(route.start.name)}`);
  }
  if(route.finish?.coordinates){
    points.push(route.finish.coordinates);
    L.marker(route.finish.coordinates,{icon:L.divIcon({className:'novera-marker novera-marker-finish',html:'<span>✓</span>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map).bindPopup(`<strong>Финиш:</strong> ${escapeHtml(route.finish.name)}`);
  }
  if(points.length) map.fitBounds(L.latLngBounds(points),{padding:[28,28]});
}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
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
