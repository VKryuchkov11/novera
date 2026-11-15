const VALHALLA_ENDPOINT = 'https://valhalla1.openstreetmap.de/route';
const CLIENT_ID = 'wayer-voronezh-prototype';

function decodePolyline6(encoded) {
  let index = 0, lat = 0, lon = 0;
  const coordinates = [];
  while (index < encoded.length) {
    let result = 0, shift = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0; shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);
    coordinates.push([lat / 1e6, lon / 1e6]);
  }
  return coordinates;
}

export async function getPedestrianRoute(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error('Для построения маршрута нужны как минимум две точки.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(VALHALLA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': CLIENT_ID
      },
      body: JSON.stringify({
        locations: stops.map(stop => ({
          lat: Number(stop.coordinates[0]),
          lon: Number(stop.coordinates[1]),
          type: 'break'
        })),
        costing: 'pedestrian',
        units: 'km',
        language: 'ru-RU',
        directions_type: 'instructions',
        shape_format: 'polyline6'
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Сервис маршрутов ответил с ошибкой (${response.status}).`);
    const data = await response.json();
    if (data.error) throw new Error(data.error_description || data.error);
    const trip = data.trip;
    if (!trip || !Array.isArray(trip.legs) || !trip.legs.length) {
      throw new Error('Сервис не вернул пешеходный маршрут для этих точек.');
    }

    const geometry = [];
    const instructions = [];
    for (const leg of trip.legs) {
      if (leg.shape) {
        const part = decodePolyline6(leg.shape);
        geometry.push(...(geometry.length ? part.slice(1) : part));
      }
      for (const maneuver of leg.maneuvers || []) {
        if (maneuver.instruction) instructions.push(maneuver.instruction);
      }
    }
    if (geometry.length < 2) throw new Error('Не удалось прочитать геометрию маршрута.');
    const summary = trip.summary || {};
    return {
      geometry,
      distanceKm: Number(summary.length || 0),
      travelMinutes: Math.ceil(Number(summary.time || 0) / 60),
      instructions
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Сервис маршрутов не ответил за 25 секунд. Попробуй ещё раз.');
    }
    if (error instanceof TypeError) {
      throw new Error('Не удалось связаться с сервисом маршрутов. Проверь интернет или попробуй позже.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
