const THEME_KEY='wayer-theme';
export function getTheme(){return localStorage.getItem(THEME_KEY)||'light';}
export function setTheme(theme){localStorage.setItem(THEME_KEY,theme);}
export function saveRating(routeId,rating){
  const ratings=JSON.parse(localStorage.getItem('wayer-ratings')||'{}');
  ratings[routeId]=rating;
  localStorage.setItem('wayer-ratings',JSON.stringify(ratings));
}

const VISITED_KEY='wayer-visited-places';
export function getVisitedPlaces(){
  try{return JSON.parse(localStorage.getItem(VISITED_KEY)||'[]');}
  catch{return [];}
}
export function saveVisitedPlace(placeId){
  const visited=getVisitedPlaces();
  if(!visited.includes(placeId)){visited.push(placeId);localStorage.setItem(VISITED_KEY,JSON.stringify(visited));}
}
