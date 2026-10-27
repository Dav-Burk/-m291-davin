const initialPlaces = [
  { id: "baulmes", name: "Baulmes", time: "08:00" },
  { id: "yverdon", name: "Yverdon-les-Bains", time: "17:30" },
  { id: "lausanne", name: "Lausanne", time: "20:00" }
];

const storageKey = "mameteo-places-v1";
const alertKey = "mameteo-alerts-v1";
const alertOptions = [[0, "Désactivé"], [15, "15 min avant"], [30, "30 min avant"], [60, "1 h avant"], [120, "2 h avant"], [180, "3 h avant"]];
const geocodingUrl = "https://geocoding-api.open-meteo.com/v1/search";
const forecastUrl = "https://api.open-meteo.com/v1/forecast";
const hourlyVariables = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code";
const screens = [...document.querySelectorAll("[data-screen]")];
const placeGrid = document.querySelector("#place-grid");
const routeList = document.querySelector("#route-list");
const notificationSetting = document.querySelector("#notification-setting");
const notificationStatus = document.querySelector("#notification-status");
const placeNameInput = document.querySelector("#new-place-name");
const placeSuggestions = document.querySelector("#place-suggestions");
const placeSearchStatus = document.querySelector("#place-search-status");
const weatherStatus = document.querySelector("#weather-status");
const refreshWeatherButton = document.querySelector("#refresh-weather");
let places = readPlaces();
let selectedPlace = places.find((place) => place.id === "yverdon") || places[0];
let alertsEnabled = localStorage.getItem(alertKey) === "true";
const alertTimers = new Map();
const weatherByPlace = new Map();
const coordinatesByPlace = new Map();
let weatherRefreshId = 0;
let weatherLastUpdated = null;
let placeSearchTimeout;
let placeSearchRequestId = 0;
let placeSearchController;
let selectedLocation;
let suggestedLocations = [];

function readPlaces() {
  try {
    const savedPlaces = JSON.parse(localStorage.getItem(storageKey));
    if (!Array.isArray(savedPlaces)) return initialPlaces.map((place) => ({ ...place, alertMinutes: 60 }));
    return savedPlaces.map((place) => {
      const alertMinutes = place.alertMinutes == null ? 60 : Number(place.alertMinutes);
      return {
        id: String(place.id),
        name: String(place.name),
        time: String(place.time),
        alertMinutes: alertOptions.some(([minutes]) => minutes === alertMinutes) ? alertMinutes : 60,
        ...(Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
          ? { latitude: place.latitude, longitude: place.longitude }
          : {})
      };
    });
  } catch {
    return initialPlaces.map((place) => ({ ...place, alertMinutes: 60 }));
  }
}

function savePlaces() {
  localStorage.setItem(storageKey, JSON.stringify(places));
}

function currentView() {
  const view = location.hash.slice(1).split("#")[0];
  return screens.some((screen) => screen.dataset.screen === view) ? view : "accueil";
}

function renderView() {
  const view = currentView();
  const activeScreen = screens.find((screen) => !screen.hidden);
  const nextScreen = screens.find((screen) => screen.dataset.screen === view);
  const updateView = () => renderViewContent(view);

  if (!activeScreen || activeScreen === nextScreen) {
    updateView();
    return;
  }

  if (typeof document.startViewTransition === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    activeScreen.style.viewTransitionName = "active-screen";
    const transition = document.startViewTransition(() => {
      activeScreen.style.viewTransitionName = "none";
      nextScreen.style.viewTransitionName = "active-screen";
      updateView();
    });
    transition.finished.then(
      () => { nextScreen.style.viewTransitionName = "none"; },
      () => { nextScreen.style.viewTransitionName = "none"; }
    );
    return;
  }

  nextScreen.classList.add("is-entering");
  nextScreen.addEventListener("animationend", () => nextScreen.classList.remove("is-entering"), { once: true });
  updateView();
}

function renderViewContent(view) {
  const isOrganizing = view === "organisation";
  screens.forEach((screen) => { screen.hidden = screen.dataset.screen !== view; });
  document.querySelector(".topbar").classList.toggle("is-organizing", isOrganizing);
  document.querySelector(".header-back").hidden = !isOrganizing;
  document.querySelector("#organize-cta").hidden = isOrganizing;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === view || (link.dataset.nav === "lieux" && view === "accueil");
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (view === "precision" || view === "precision-plus") renderDetail();
  if (view === "organisation") renderRoutes();
  if (location.hash === "#lieux") document.querySelector("#lieux").scrollIntoView({ behavior: "smooth" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

function weatherMarkup(place) {
  const weather = weatherByPlace.get(place.id);
  return `<span class="weather-symbol" aria-hidden="true">${weather?.symbol || "…"}</span>`;
}

function formatWeatherValue(value, suffix = "") {
  return Number.isFinite(value) ? `${Math.round(value)}${suffix}` : "—";
}

function updateWeatherStatus() {
  const states = places.map((place) => weatherByPlace.get(place.id));
  const failures = places.filter((place) => weatherByPlace.get(place.id)?.status === "error");
  const loading = states.some((state) => !state || state.status === "loading");
  refreshWeatherButton.disabled = loading || places.length === 0;

  if (places.length === 0) {
    weatherStatus.textContent = "Ajoutez un lieu pour afficher les prévisions météo.";
  } else if (loading) {
    weatherStatus.textContent = "Chargement des prévisions météo depuis Open-Meteo…";
  } else if (failures.length > 0) {
    weatherStatus.textContent = `${failures.map((place) => `${place.name} : ${weatherByPlace.get(place.id).error}`).join(" · ")} Vérifiez le lieu ou votre connexion, puis réessayez.`;
  } else {
    const updatedTime = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" }).format(weatherLastUpdated || new Date());
    weatherStatus.textContent = `Prévisions mises à jour à ${updatedTime}.`;
  }
}

function renderPlaces(filter = "") {
  const matches = places.filter((place) => place.name.toLowerCase().includes(filter.toLowerCase()));
  placeGrid.innerHTML = matches.map((place) => {
    const weather = weatherByPlace.get(place.id);
    const condition = weather?.status === "loaded" ? weather.condition
      : weather?.status === "error" ? "Météo indisponible" : "Chargement…";
    const temperature = weather?.status === "loaded" ? formatWeatherValue(weather.temperature, "°") : "—";
    const wind = weather?.status === "loaded" ? formatWeatherValue(weather.wind, " km/h") : "—";
    const clouds = weather?.status === "loaded" ? formatWeatherValue(weather.clouds, "%") : "—";
    return `
    <article class="place-row">
      <a class="place-name" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="temperature"><span class="place-time">${place.time}</span><h3>${escapeHtml(place.name)}</h3><span class="place-condition">${weatherMarkup(place)} ${escapeHtml(condition)}</span><span class="place-see-all">Toutes les données <span aria-hidden="true">→</span></span></a>
      <a class="place-metric" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="temperature"><span>Température</span><strong>${temperature}</strong></a>
      <a class="place-metric" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="wind"><span>Vent</span><strong>${wind}</strong></a>
      <a class="place-metric" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="clouds"><span>Nuages</span><strong>${clouds}</strong></a>
    </article>`;
  }).join("");
  document.querySelector("#empty-state").hidden = matches.length > 0;
}

function renderHomeWeather() {
  const select = document.querySelector("#featured-place");
  select.innerHTML = places.map((place) => `<option value="${escapeHtml(place.id)}">${escapeHtml(place.name)}</option>`).join("");
  if (!places.some((place) => place.id === selectedPlace?.id)) selectedPlace = places[0];
  if (!selectedPlace) {
    document.querySelector("#weather-summary").hidden = true;
    document.querySelector("#featured-time").textContent = "";
    updateWeatherStatus();
    return;
  }
  document.querySelector("#weather-summary").hidden = false;
  select.value = selectedPlace.id;
  document.querySelector("#featured-time").textContent = `${selectedPlace.time} · passage habituel`;
  const weather = weatherByPlace.get(selectedPlace.id);
  const isLoaded = weather?.status === "loaded";
  document.querySelector("#summary-temperature").textContent = formatWeatherValue(weather?.temperature, "°");
  document.querySelector("#summary-temperature-hint").textContent = isLoaded ? `Ressenti ${formatWeatherValue(weather.apparentTemperature, "°")}` : "Prévision au passage";
  document.querySelector("#summary-wind").innerHTML = `${formatWeatherValue(weather?.wind)} <small>km/h</small>`;
  document.querySelector("#summary-wind-hint").textContent = isLoaded ? weather.windDirection : "Prévision au passage";
  document.querySelector("#summary-clouds").innerHTML = `${formatWeatherValue(weather?.clouds)}<small>%</small>`;
  document.querySelector("#summary-clouds-hint").textContent = isLoaded ? "Couverture nuageuse" : "Prévision au passage";
  updateWeatherStatus();
}

function renderRoutes() {
  routeList.innerHTML = places.map((place, index) => `
    <li class="route-row" data-route-id="${escapeHtml(place.id)}">
      <span class="route-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="route-name">${escapeHtml(place.name)}</span>
      <time class="route-time">${place.time}</time>
      <label class="route-reminder">
        <span class="visually-hidden">Rappel pour ${escapeHtml(place.name)}</span>
        <select data-alert-minutes="${escapeHtml(place.id)}" aria-label="Délai du rappel pour ${escapeHtml(place.name)}">
          ${alertOptions.map(([minutes, label]) => `<option value="${minutes}" ${place.alertMinutes === minutes ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <span class="route-actions">
        <button class="icon-button" type="button" data-move="up" aria-label="Monter ${escapeHtml(place.name)}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-button" type="button" data-move="down" aria-label="Descendre ${escapeHtml(place.name)}" ${index === places.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon-button remove" type="button" data-remove="${escapeHtml(place.id)}" aria-label="Supprimer ${escapeHtml(place.name)}">×</button>
      </span>
    </li>`).join("");
}

function renderDetail() {
  if (!selectedPlace) return;
  const place = selectedPlace;
  const weather = weatherByPlace.get(place.id);
  const isLoaded = weather?.status === "loaded";
  document.querySelector("#detail-kicker").textContent = `VOTRE TRAJET · ${place.time}`;
  document.querySelector("#detail-title").textContent = place.name;
  document.querySelector("#detail-description").textContent = isLoaded
    ? `Prévisions à ${place.time} : ${weather.condition.toLowerCase()} · ${weather.dateLabel}.`
    : weather?.status === "error" ? weather.error : "Chargement des prévisions météo…";
  document.querySelector("#detail-symbol").textContent = weather?.symbol || "…";
  document.querySelector("#detail-temperature-value").textContent = formatWeatherValue(weather?.temperature, "°");
  document.querySelector("#detail-condition").textContent = isLoaded ? weather.condition : "—";
  document.querySelector("#temperature-symbol").textContent = weather?.symbol || "…";
  document.querySelector("#measure-temperature-value").textContent = formatWeatherValue(weather?.temperature, "°");
  document.querySelector("#measure-condition").textContent = isLoaded ? weather.condition : "—";
  document.querySelector("#fact-feels-like").textContent = formatWeatherValue(weather?.apparentTemperature, "°");
  document.querySelector("#temperature-advice").textContent = isLoaded
    ? Number.isFinite(weather.temperature)
      ? weather.temperature < 10 ? "Une veste chaude sera utile." : "Une veste légère suffira."
      : "Température ressentie indisponible."
    : "Conseil disponible avec les prévisions.";
  document.querySelector("#fact-wind").innerHTML = `${formatWeatherValue(weather?.wind)} <small>km/h</small>`;
  document.querySelector("#wind-direction").textContent = isLoaded ? weather.windDirection : "—";
  document.querySelector("#wind-gusts").textContent = formatWeatherValue(weather?.gusts, " km/h");
  document.querySelector("#wind-advice").textContent = isLoaded
    ? Number.isFinite(weather.wind)
      ? weather.wind > 16 ? "Une couche coupe-vent sera utile." : "Le vent restera modéré."
      : "Vitesse du vent indisponible."
    : "Conseil disponible avec les prévisions.";
  document.querySelector("#fact-clouds").textContent = formatWeatherValue(weather?.clouds, " %");
  document.querySelector("#fact-humidity").textContent = formatWeatherValue(weather?.humidity, " %");
  document.querySelector("#fact-precipitation").textContent = formatWeatherValue(weather?.precipitation, " %");
  document.querySelector("#cloud-cover-fill").style.width = isLoaded && Number.isFinite(weather.clouds) ? `${weather.clouds}%` : "0%";
  document.querySelector("#forecast-location").textContent = isLoaded ? `${place.name} · ${weather.dateLabel}` : place.name;
  renderForecast(weather);
}

function renderForecast(weather) {
  const forecastStrip = document.querySelector("#forecast-strip");
  if (weather?.status !== "loaded") {
    forecastStrip.innerHTML = `<p class="forecast-message">${weather?.status === "error" ? escapeHtml(weather.error) : "Chargement des prévisions météo…"}</p>`;
    return;
  }
  forecastStrip.innerHTML = weather.hours.map((hour) => `
    <div class="forecast-hour ${hour.isArrival ? "is-arrival" : ""}">
      <time>${hour.time}</time><span class="weather-symbol" aria-hidden="true">${hour.symbol}</span>
      <strong>${formatWeatherValue(hour.temperature, "°")}</strong><small>${escapeHtml(hour.condition)}</small>
    </div>`).join("");
}

function describeWeatherCode(code) {
  const conditions = {
    0: ["Ensoleillé", "☀"], 1: ["Peu nuageux", "🌤"], 2: ["Partiellement nuageux", "⛅"], 3: ["Couvert", "☁"],
    45: ["Brouillard", "🌫"], 48: ["Brouillard givrant", "🌫"],
    51: ["Bruine légère", "🌦"], 53: ["Bruine", "🌦"], 55: ["Bruine dense", "🌧"], 56: ["Bruine verglaçante", "🌧"], 57: ["Bruine verglaçante dense", "🌧"],
    61: ["Pluie faible", "🌧"], 63: ["Pluie", "🌧"], 65: ["Pluie forte", "🌧"], 66: ["Pluie verglaçante", "🌧"], 67: ["Pluie verglaçante forte", "🌧"],
    71: ["Neige faible", "❄"], 73: ["Neige", "❄"], 75: ["Neige forte", "❄"], 77: ["Grains de neige", "❄"],
    80: ["Averses faibles", "🌦"], 81: ["Averses", "🌧"], 82: ["Averses fortes", "🌧"], 85: ["Averses de neige", "🌨"], 86: ["Averses de neige fortes", "🌨"],
    95: ["Orage", "⛈"], 96: ["Orage et grêle", "⛈"], 99: ["Orage et forte grêle", "⛈"]
  };
  return conditions[code] || ["Conditions variables", "☁"];
}

function describeWindDirection(degrees) {
  if (!Number.isFinite(degrees)) return "—";
  const directions = ["Nord", "Nord-est", "Est", "Sud-est", "Sud", "Sud-ouest", "Ouest", "Nord-ouest"];
  return directions[Math.round(degrees / 45) % directions.length];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.reason || `Le service météo a répondu avec l’erreur ${response.status}.`);
  return result;
}

function locationDescription(location) {
  return [location.admin1, location.country].filter(Boolean).join(", ");
}

function hidePlaceSuggestions() {
  placeSuggestions.hidden = true;
  placeNameInput.setAttribute("aria-expanded", "false");
}

function renderPlaceSuggestions(locations) {
  suggestedLocations = locations;
  placeSuggestions.replaceChildren();
  locations.forEach((location, index) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const description = document.createElement("span");
    item.className = "place-suggestion";
    item.id = `place-suggestion-${index}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.tabIndex = -1;
    item.dataset.locationIndex = String(index);
    name.textContent = location.name;
    description.textContent = locationDescription(location);
    item.append(name, description);
    placeSuggestions.append(item);
  });
  placeSuggestions.hidden = locations.length === 0;
  placeNameInput.setAttribute("aria-expanded", String(locations.length > 0));
}

async function searchPlaces(query, requestId, signal) {
  const params = new URLSearchParams({ name: query, count: "8", language: "fr", format: "json", countryCode: "CH" });
  const result = await fetchJson(`${geocodingUrl}?${params}`, { signal });
  if (requestId !== placeSearchRequestId) return;
  const locations = (result.results || []).filter((location) =>
    location.country_code === "CH" && Number.isFinite(location.latitude) && Number.isFinite(location.longitude));
  renderPlaceSuggestions(locations);
  placeSearchStatus.textContent = locations.length
    ? `${locations.length} suggestions. Choisissez le lieu correspondant.`
    : "Aucun lieu trouvé. Essayez un autre nom.";
}

async function fetchPlaceWeather(place) {
  let coordinates = coordinatesByPlace.get(place.id);
  if (!coordinates && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
    coordinates = { latitude: place.latitude, longitude: place.longitude };
  }
  if (!coordinates) {
    const geocodingQuery = new URLSearchParams({ name: place.name, count: "10", language: "fr", format: "json", countryCode: "CH" });
    const geocodingResult = await fetchJson(`${geocodingUrl}?${geocodingQuery}`);
    const location = geocodingResult.results?.find((result) => result.country_code === "CH");
    if (!location) throw new Error(`Lieu suisse introuvable : « ${place.name} ».`);
    coordinates = { latitude: location.latitude, longitude: location.longitude };
    coordinatesByPlace.set(place.id, coordinates);
  }

  const forecastQuery = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    hourly: hourlyVariables,
    forecast_days: "7",
    timezone: "auto",
    wind_speed_unit: "kmh"
  });
  const result = await fetchJson(`${forecastUrl}?${forecastQuery}`);
  const hourly = result.hourly;
  if (!Array.isArray(hourly?.time) || !hourly.time.length) throw new Error("Le service n’a renvoyé aucune prévision horaire.");

  const timezone = result.timezone || "Europe/Zurich";
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const datePart = (type) => dateParts.find((part) => part.type === type).value;
  let targetDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(now);
  if (place.time <= localTime) {
    const tomorrow = new Date(`${targetDate}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    targetDate = tomorrow.toISOString().slice(0, 10);
  }

  const targetTimestamp = Date.parse(`${targetDate}T${place.time}:00Z`);
  let arrivalIndex = -1;
  let smallestDifference = Infinity;
  hourly.time.forEach((time, index) => {
    const difference = Math.abs(Date.parse(`${time}:00Z`) - targetTimestamp);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      arrivalIndex = index;
    }
  });
  if (arrivalIndex < 0 || smallestDifference > 60 * 60 * 1000) {
    throw new Error(`Aucune prévision horaire n’est disponible autour de ${place.time}.`);
  }

  const valueAt = (key, index = arrivalIndex) => {
    const value = hourly[key]?.[index];
    return Number.isFinite(value) ? value : null;
  };
  const [condition, symbol] = describeWeatherCode(valueAt("weather_code"));
  const dateLabel = new Intl.DateTimeFormat("fr-CH", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
  }).format(new Date(`${targetDate}T12:00:00Z`));
  const firstHourIndex = Math.max(0, arrivalIndex - 2);
  const hours = hourly.time.slice(firstHourIndex, firstHourIndex + 6).map((time, offset) => {
    const index = firstHourIndex + offset;
    const [hourCondition, hourSymbol] = describeWeatherCode(valueAt("weather_code", index));
    return {
      time: time.slice(-5),
      temperature: valueAt("temperature_2m", index),
      condition: hourCondition,
      symbol: hourSymbol,
      isArrival: index === arrivalIndex
    };
  });

  return {
    status: "loaded",
    temperature: valueAt("temperature_2m"),
    apparentTemperature: valueAt("apparent_temperature"),
    condition,
    symbol,
    wind: valueAt("wind_speed_10m"),
    windDirection: describeWindDirection(valueAt("wind_direction_10m")),
    gusts: valueAt("wind_gusts_10m"),
    clouds: valueAt("cloud_cover"),
    humidity: valueAt("relative_humidity_2m"),
    precipitation: valueAt("precipitation_probability"),
    dateLabel,
    hours
  };
}

async function refreshWeather() {
  const requestId = ++weatherRefreshId;
  places.forEach((place) => weatherByPlace.set(place.id, { status: "loading" }));
  renderPlaces(document.querySelector("#place-search").value);
  renderHomeWeather();
  if (selectedPlace && currentView() === "precision") renderDetail();
  if (selectedPlace && currentView() === "precision-plus") renderForecast(weatherByPlace.get(selectedPlace.id));
  updateWeatherStatus();

  await Promise.all(places.map(async (place) => {
    try {
      const weather = await fetchPlaceWeather(place);
      if (requestId !== weatherRefreshId || !places.some((item) => item.id === place.id)) return;
      weatherByPlace.set(place.id, weather);
    } catch (error) {
      if (requestId !== weatherRefreshId || !places.some((item) => item.id === place.id)) return;
      weatherByPlace.set(place.id, {
        status: "error",
        error: error instanceof Error ? error.message : "Erreur inconnue lors du chargement des prévisions."
      });
    }
    renderPlaces(document.querySelector("#place-search").value);
    renderHomeWeather();
    if (selectedPlace && currentView() === "precision") renderDetail();
    if (selectedPlace && currentView() === "precision-plus") renderForecast(weatherByPlace.get(selectedPlace.id));
  }));
  if (requestId === weatherRefreshId) {
    weatherLastUpdated = new Date();
    updateWeatherStatus();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function selectPlace(id) {
  const place = places.find((item) => item.id === id);
  if (place) selectedPlace = place;
}

document.addEventListener("click", (event) => {
  const placeLink = event.target.closest("[data-place]");
  if (placeLink) {
    selectPlace(placeLink.dataset.place);
  }

  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    const removedId = removeButton.dataset.remove;
    places = places.filter((place) => place.id !== removedId);
    weatherByPlace.delete(removedId);
    coordinatesByPlace.delete(removedId);
    savePlaces();
    renderPlaces(document.querySelector("#place-search").value);
    renderHomeWeather();
    renderRoutes();
    scheduleAlerts();
  }

  const moveButton = event.target.closest("[data-move]");
  if (moveButton) {
    const row = moveButton.closest("[data-route-id]");
    const index = places.findIndex((place) => place.id === row.dataset.routeId);
    const target = moveButton.dataset.move === "up" ? index - 1 : index + 1;
    if (target >= 0 && target < places.length) {
      [places[index], places[target]] = [places[target], places[index]];
      savePlaces();
      renderRoutes();
    }
  }
});

routeList.addEventListener("change", (event) => {
  const reminderSelect = event.target.closest("[data-alert-minutes]");
  if (!reminderSelect) return;
  const place = places.find((item) => item.id === reminderSelect.dataset.alertMinutes);
  if (!place) return;
  place.alertMinutes = Number(reminderSelect.value);
  savePlaces();
  scheduleAlerts();
});

placeNameInput.addEventListener("input", () => {
  selectedLocation = undefined;
  placeSearchRequestId += 1;
  clearTimeout(placeSearchTimeout);
  placeSearchController?.abort();
  const query = placeNameInput.value.trim();

  if (query.length < 2) {
    renderPlaceSuggestions([]);
    placeSearchStatus.textContent = "Saisissez au moins deux caractères pour rechercher un lieu.";
    return;
  }

  hidePlaceSuggestions();
  placeSearchStatus.textContent = "Recherche des lieux…";
  const requestId = placeSearchRequestId;
  placeSearchTimeout = setTimeout(() => {
    placeSearchController = new AbortController();
    searchPlaces(query, requestId, placeSearchController.signal).catch((error) => {
      if (requestId !== placeSearchRequestId || error.name === "AbortError") return;
      renderPlaceSuggestions([]);
      placeSearchStatus.textContent = `Impossible de rechercher les lieux : ${error.message}`;
    });
  }, 250);
});

placeNameInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && !placeSuggestions.hidden) {
    event.preventDefault();
    placeSuggestions.querySelector(".place-suggestion")?.focus();
  } else if (event.key === "Escape") {
    hidePlaceSuggestions();
  }
});

placeSuggestions.addEventListener("keydown", (event) => {
  const options = [...placeSuggestions.querySelectorAll(".place-suggestion")];
  const index = options.indexOf(event.target.closest(".place-suggestion"));
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + direction + options.length) % options.length;
    options[nextIndex]?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.target.click();
  } else if (event.key === "Escape") {
    hidePlaceSuggestions();
    placeNameInput.focus();
  }
});

placeSuggestions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-location-index]");
  if (!option) return;
  const location = suggestedLocations[Number(option.dataset.locationIndex)];
  if (!location) return;

  selectedLocation = location;
  placeNameInput.value = location.name;
  placeSearchStatus.textContent = `Lieu sélectionné : ${[location.name, locationDescription(location)].filter(Boolean).join(", ")}.`;
  hidePlaceSuggestions();
  placeNameInput.focus();
});

document.querySelector("#place-search").addEventListener("input", (event) => renderPlaces(event.target.value));
document.querySelector("#featured-place").addEventListener("change", (event) => {
  selectPlace(event.target.value);
  renderHomeWeather();
});

document.querySelector("#add-place-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name")).trim();
  const time = String(form.get("time"));
  if (!name || !time) return;
  if (!selectedLocation || name !== selectedLocation.name) {
    placeSearchStatus.textContent = "Choisissez un lieu dans les suggestions avant de l’ajouter.";
    placeNameInput.focus();
    return;
  }

  const { latitude, longitude } = selectedLocation;
  const id = `lieu-${Date.now()}`;
  places.push({ id, name, time, latitude, longitude, alertMinutes: 60 });
  coordinatesByPlace.set(id, { latitude, longitude });
  savePlaces();
  renderPlaces(document.querySelector("#place-search").value);
  renderHomeWeather();
  renderRoutes();
  scheduleAlerts();
  refreshWeather();
  event.currentTarget.reset();
  selectedLocation = undefined;
  renderPlaceSuggestions([]);
  placeSearchStatus.textContent = "Saisissez au moins deux caractères pour rechercher un lieu.";
  placeNameInput.focus();
});

refreshWeatherButton.addEventListener("click", refreshWeather);
notificationSetting.checked = alertsEnabled;

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function updateNotificationStatus(message) {
  if (message) {
    notificationStatus.textContent = message;
  } else if (!alertsEnabled) {
    notificationStatus.textContent = "Choisissez un délai par lieu, puis activez les notifications.";
  } else if (!("Notification" in window)) {
    notificationStatus.textContent = "Les notifications du navigateur ne sont pas disponibles ici.";
  } else if (Notification.permission === "granted") {
    notificationStatus.textContent = "Rappels actifs tant que cette page reste ouverte.";
  } else if (Notification.permission === "denied") {
    notificationStatus.textContent = "Autorisation refusée. Modifiez ce réglage dans les paramètres du navigateur.";
  } else {
    notificationStatus.textContent = "Autorisez les notifications du navigateur en activant le rappel.";
  }
}

function schedulePlaceAlert(place) {
  const existingTimer = alertTimers.get(place.id);
  if (existingTimer) clearTimeout(existingTimer);
  alertTimers.delete(place.id);
  if (!alertsEnabled || place.alertMinutes === 0 || !("Notification" in window) || Notification.permission !== "granted") return;

  const now = new Date();
  const [hours, minutes] = place.time.split(":").map(Number);
  const arrival = new Date(now);
  arrival.setHours(hours, minutes, 0, 0);
  if (arrival <= now) arrival.setDate(arrival.getDate() + 1);

  let targetDate = dateKey(arrival);
  const sentKey = `${alertKey}-sent-${place.id}`;
  if (localStorage.getItem(sentKey) === targetDate) {
    arrival.setDate(arrival.getDate() + 1);
    targetDate = dateKey(arrival);
  }

  const notificationTime = arrival.getTime() - place.alertMinutes * 60 * 1000;
  const timer = setTimeout(() => {
    alertTimers.delete(place.id);
    const currentPlace = places.find((item) => item.id === place.id);
    if (!currentPlace || !alertsEnabled || currentPlace.alertMinutes === 0) return;
    if (arrival <= new Date()) {
      schedulePlaceAlert(currentPlace);
      return;
    }

    localStorage.setItem(sentKey, targetDate);
    try {
      new Notification(`Rappel météo · ${currentPlace.name}`, {
        body: `Vous passerez ici à ${currentPlace.time}.`,
        tag: `mameteo-${currentPlace.id}-${targetDate}`
      });
    } catch (error) {
      updateNotificationStatus(`Impossible d’afficher le rappel : ${error.message}`);
    }
    schedulePlaceAlert(currentPlace);
  }, Math.max(0, notificationTime - now.getTime()));
  alertTimers.set(place.id, timer);
}

function scheduleAlerts() {
  for (const timer of alertTimers.values()) clearTimeout(timer);
  alertTimers.clear();
  places.forEach(schedulePlaceAlert);
}

async function setAlerts(enabled) {
  if (!enabled) {
    alertsEnabled = false;
    localStorage.setItem(alertKey, "false");
    notificationSetting.checked = false;
    updateNotificationStatus();
    scheduleAlerts();
    return;
  }

  if (!("Notification" in window)) {
    alertsEnabled = false;
    localStorage.setItem(alertKey, "false");
    notificationSetting.checked = false;
    updateNotificationStatus("Les notifications du navigateur ne sont pas disponibles ici.");
    scheduleAlerts();
    return;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch (error) {
      alertsEnabled = false;
      localStorage.setItem(alertKey, "false");
      notificationSetting.checked = false;
      updateNotificationStatus(`Impossible de demander l’autorisation : ${error.message}`);
      scheduleAlerts();
      return;
    }
  }
  if (permission !== "granted") {
    alertsEnabled = false;
    localStorage.setItem(alertKey, "false");
    notificationSetting.checked = false;
    updateNotificationStatus(permission === "denied"
      ? "Autorisation refusée. Modifiez ce réglage dans les paramètres du navigateur."
      : "L’autorisation de notification n’a pas été accordée.");
    scheduleAlerts();
    return;
  }

  alertsEnabled = true;
  localStorage.setItem(alertKey, String(enabled));
  notificationSetting.checked = enabled;
  updateNotificationStatus();
  scheduleAlerts();
}

notificationSetting.addEventListener("change", () => { setAlerts(notificationSetting.checked); });

const todayLabel = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
document.querySelector("#today-label").textContent = `${todayLabel.toLocaleUpperCase("fr-CH")} · VOTRE MÉTÉO EN UN COUP D’ŒIL`;
renderPlaces();
renderHomeWeather();
renderRoutes();
updateNotificationStatus();
scheduleAlerts();
refreshWeather();
const weatherRefreshInterval = 30 * 60 * 1000;
setInterval(() => {
  if (!document.hidden) refreshWeather();
}, weatherRefreshInterval);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (!weatherLastUpdated || Date.now() - weatherLastUpdated.getTime() >= weatherRefreshInterval)) {
    refreshWeather();
  }
});
window.addEventListener("hashchange", renderView);
renderView();