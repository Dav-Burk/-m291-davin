const initialPlaces = [
  { id: "baulmes", name: "Baulmes", time: "08:00", temperature: 15, condition: "Dégagé", symbol: "☀", wind: 9, windDirection: "Nord-est", gusts: 14, clouds: 12, humidity: 57, precipitation: 5 },
  { id: "yverdon", name: "Yverdon-les-Bains", time: "17:30", temperature: 17, condition: "Nuageux", symbol: "☁", wind: 14, windDirection: "Ouest", gusts: 21, clouds: 70, humidity: 68, precipitation: 20 },
  { id: "lausanne", name: "Lausanne", time: "20:00", temperature: 14, condition: "Averses", symbol: "☂", wind: 18, windDirection: "Sud-ouest", gusts: 27, clouds: 88, humidity: 79, precipitation: 75 }
];

const storageKey = "mameteo-places-v1";
const alertKey = "mameteo-alerts-v1";
const screens = [...document.querySelectorAll("[data-screen]")];
const placeGrid = document.querySelector("#place-grid");
const routeList = document.querySelector("#route-list");
let places = readPlaces();
let selectedPlace = places.find((place) => place.id === "yverdon") || places[0];

function readPlaces() {
  try {
    const savedPlaces = JSON.parse(localStorage.getItem(storageKey));
    if (!Array.isArray(savedPlaces)) return initialPlaces.map((place) => ({ ...place }));
    return savedPlaces.map((place) => {
      const defaults = initialPlaces.find((item) => item.id === place.id);
      return {
        ...defaults,
        ...place,
        windDirection: place.windDirection || defaults?.windDirection || "Ouest",
        gusts: place.gusts ?? defaults?.gusts ?? place.wind + 6,
        precipitation: place.precipitation ?? defaults?.precipitation ?? (place.condition === "Averses" ? 75 : 20)
      };
    });
  } catch {
    return initialPlaces.map((place) => ({ ...place }));
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
  return `<span class="weather-symbol" aria-hidden="true">${place.symbol}</span>`;
}

function renderPlaces(filter = "") {
  const matches = places.filter((place) => place.name.toLowerCase().includes(filter.toLowerCase()));
  placeGrid.innerHTML = matches.map((place) => `
    <div class="place-row">
      <a class="place-name" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="temperature"><span class="place-time">${place.time}</span><strong>${escapeHtml(place.name)}</strong><span class="place-condition">${weatherMarkup(place)} ${escapeHtml(place.condition)}</span><span class="place-see-all">Toutes les données <span aria-hidden="true">→</span></span></a>
      <a class="place-metric" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="temperature"><span>Température</span><strong>${place.temperature}°</strong></a>
      <a class="place-metric" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="wind"><span>Vent</span><strong>${place.wind} <small>km/h</small></strong></a>
      <a class="place-metric" href="#precision" data-place="${escapeHtml(place.id)}" data-metric-link="clouds"><span>Nuages</span><strong>${place.clouds}<small>%</small></strong></a>
    </div>`).join("");
  document.querySelector("#empty-state").hidden = matches.length > 0;
}

function renderHomeWeather() {
  const select = document.querySelector("#featured-place");
  select.innerHTML = places.map((place) => `<option value="${escapeHtml(place.id)}">${escapeHtml(place.name)}</option>`).join("");
  if (!places.some((place) => place.id === selectedPlace?.id)) selectedPlace = places[0];
  if (!selectedPlace) {
    document.querySelector("#weather-summary").hidden = true;
    document.querySelector("#featured-time").textContent = "";
    return;
  }
  document.querySelector("#weather-summary").hidden = false;
  select.value = selectedPlace.id;
  document.querySelector("#featured-time").textContent = `${selectedPlace.time} · passage habituel`;
  document.querySelector("#summary-temperature").textContent = `${selectedPlace.temperature}°`;
  document.querySelector("#summary-wind").innerHTML = `${selectedPlace.wind} <small>km/h</small>`;
  document.querySelector("#summary-clouds").innerHTML = `${selectedPlace.clouds}<small>%</small>`;
}

function renderRoutes() {
  routeList.innerHTML = places.map((place, index) => `
    <li class="route-row" data-route-id="${escapeHtml(place.id)}">
      <span class="route-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="route-name">${escapeHtml(place.name)}</span>
      <time class="route-time">${place.time}</time>
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
  document.querySelector("#detail-kicker").textContent = `VOTRE TRAJET · ${place.time}`;
  document.querySelector("#detail-title").textContent = place.name;
  document.querySelector("#detail-description").textContent = `Météo prévue à l’heure de votre passage : ${place.condition.toLowerCase()}.`;
  document.querySelector("#detail-symbol").textContent = place.symbol;
  document.querySelector("#detail-temperature-value").textContent = `${place.temperature}°`;
  document.querySelector("#detail-condition").textContent = place.condition;
  document.querySelector("#temperature-symbol").textContent = place.symbol;
  document.querySelector("#measure-temperature-value").textContent = `${place.temperature}°`;
  document.querySelector("#measure-condition").textContent = place.condition;
  document.querySelector("#fact-feels-like").textContent = `${place.temperature - 1}°`;
  document.querySelector("#temperature-advice").textContent = place.temperature < 10 ? "Une veste chaude sera utile." : "Une veste légère suffira.";
  document.querySelector("#fact-wind").textContent = `${place.wind} km/h`;
  document.querySelector("#wind-direction").textContent = place.windDirection;
  document.querySelector("#wind-gusts").textContent = `${place.gusts} km/h`;
  document.querySelector("#wind-advice").textContent = place.wind > 16 ? "Une couche coupe-vent sera utile." : "Le vent restera modéré.";
  document.querySelector("#fact-clouds").textContent = `${place.clouds} %`;
  document.querySelector("#fact-humidity").textContent = `${place.humidity} %`;
  document.querySelector("#fact-precipitation").textContent = `${place.precipitation} %`;
  document.querySelector("#cloud-cover-fill").style.width = `${place.clouds}%`;
  document.querySelector("#forecast-location").textContent = `${place.name} · aujourd’hui`;
  renderForecast();
}

function renderForecast() {
  const forecasts = [
    ["15:00", selectedPlace.temperature - 1, "☀", "Éclaircies"],
    ["16:00", selectedPlace.temperature, "☁", "Nuageux"],
    ["17:00", selectedPlace.temperature, selectedPlace.symbol, selectedPlace.condition],
    ["18:00", selectedPlace.temperature - 1, "☁", "Nuageux"],
    ["19:00", selectedPlace.temperature - 2, "☂", "Quelques gouttes"],
    ["20:00", selectedPlace.temperature - 2, "☁", "Couvert"]
  ];
  document.querySelector("#forecast-strip").innerHTML = forecasts.map(([time, temperature, symbol, condition]) => `
    <div class="forecast-hour"><time>${time}</time><span class="weather-symbol" aria-hidden="true">${symbol}</span><strong>${temperature}°</strong><small>${condition}</small></div>`).join("");
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
    places = places.filter((place) => place.id !== removeButton.dataset.remove);
    savePlaces();
    renderPlaces(document.querySelector("#place-search").value);
    renderHomeWeather();
    renderRoutes();
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
  const id = `lieu-${Date.now()}`;
  places.push({ id, name, time, temperature: 16, condition: "Nuageux", symbol: "☁", wind: 11, windDirection: "Ouest", gusts: 16, clouds: 55, humidity: 64, precipitation: 20 });
  savePlaces();
  renderPlaces(document.querySelector("#place-search").value);
  renderHomeWeather();
  renderRoutes();
  event.currentTarget.reset();
  document.querySelector("#new-place-name").focus();
});

const notificationSetting = document.querySelector("#notification-setting");
const alertsEnabled = localStorage.getItem(alertKey) === "true";
notificationSetting.checked = alertsEnabled;

function setAlerts(enabled) {
  localStorage.setItem(alertKey, String(enabled));
  notificationSetting.checked = enabled;
}

notificationSetting.addEventListener("change", () => setAlerts(notificationSetting.checked));

const todayLabel = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
document.querySelector("#today-label").textContent = `${todayLabel.toLocaleUpperCase("fr-CH")} · VOTRE MÉTÉO EN UN COUP D’ŒIL`;
renderPlaces();
renderHomeWeather();
renderRoutes();
window.addEventListener("hashchange", renderView);
renderView();