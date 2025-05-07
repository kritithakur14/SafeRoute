const socket = io(); // Initialize socket.io
const map = L.map("map").setView([51.505, -0.09], 13); // Default view

L.tileLayer("https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

let routePolyline;
let destinationMarker;
let userMarker;
let incidentMarkers = [];
let manualLocation = null;
let routeCoordinates = [];

// Toast function
function showToast(message) {
  Toastify({
    text: message,
    duration: 10000,
    gravity: "top",
    position: "right",
    backgroundColor: "#4CAF50",
    stopOnFocus: true,
  }).showToast();
}

// Auto-center map on load
centerMapToCurrentLocation();
enableManualLocationSelection();

// Center the map to the user's location
function centerMapToCurrentLocation() {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      map.setView([latitude, longitude], 13);

      if (userMarker) {
        userMarker.setLatLng([latitude, longitude]);
      } else {
        userMarker = L.marker([latitude, longitude])
          .addTo(map)
          .bindPopup("You are here")
          .openPopup();
      }
    },
    () => alert("Unable to retrieve your location.")
  );
}

// Manual location selection
function enableManualLocationSelection() {
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    manualLocation = { latitude: lat, longitude: lng };

    if (userMarker) {
      userMarker.setLatLng([lat, lng]).bindPopup("Manual Location").openPopup();
    } else {
      userMarker = L.marker([lat, lng])
        .addTo(map)
        .bindPopup("Manual Location")
        .openPopup();
    }

    console.log(`Manual location set: ${lat}, ${lng}`);
  });
}

// Route calculation and hazard fetching
async function handleDestinationSearch(event) {
  event.preventDefault();
  const destinationInput = document.getElementById("destination").value.trim();
  if (!destinationInput) return;

  try {
    const geoResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        destinationInput
      )}`
    );
    const geoData = await geoResponse.json();
    if (geoData.length === 0) {
      document.getElementById("info").innerText = "Destination not found.";
      return;
    }

    const { lat: destLat, lon: destLon } = geoData[0];

    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;

      const routeResponse = await fetch(
        `/api/traffic?sourceLat=${latitude}&sourceLng=${longitude}&destLat=${destLat}&destLng=${destLon}`
      );
      const routeData = await routeResponse.json();

      if (!routeData.features || !routeData.features[0]?.geometry) {
        document.getElementById("info").innerText = "Invalid route data.";
        return;
      }

      // Clear existing
      map.eachLayer((layer) => {
        if (
          layer instanceof L.Marker ||
          layer instanceof L.Polyline ||
          layer instanceof L.CircleMarker
        ) {
          if (layer !== userMarker) map.removeLayer(layer);
        }
      });

      // Draw route
      routeCoordinates = routeData.features[0].geometry.coordinates.map(
        ([lon, lat]) => [lat, lon]
      );
      routePolyline = L.polyline(routeCoordinates, { color: "green" }).addTo(
        map
      );

      // Add destination marker
      destinationMarker = L.marker([destLat, destLon])
        .addTo(map)
        .bindPopup(`Destination: ${destinationInput}`)
        .openPopup();

      fetchAndDisplayRouteHazards(routeCoordinates);
    });
  } catch (error) {
    console.error("Error fetching route:", error);
  }
}

// Fetch hazards near route
async function fetchAndDisplayRouteHazards(routeCoordinates) {
  try {
    const response = await fetch("/api/hazards");
    if (!response.ok) throw new Error("Failed to fetch hazards");

    const hazards = await response.json();
    const filteredHazards = hazards.filter((hazard) =>
      isHazardNearRoute(hazard, routeCoordinates)
    );

    // Clear old
    incidentMarkers.forEach((marker) => map.removeLayer(marker));
    incidentMarkers = [];

    filteredHazards.forEach((hazard) => {
      const color =
        hazard.type.toLowerCase() === "accident"
          ? "red"
          : hazard.type.toLowerCase() === "roadblock"
          ? "orange"
          : "blue";

      const affectedPoints = routeCoordinates.filter(([lat, lon]) =>
        isHazardNearPoint(hazard, lat, lon)
      );

      if (affectedPoints.length > 1) {
        const hazardLine = L.polyline(affectedPoints, {
          color,
          weight: 6,
          opacity: 1,
          dashArray: "10,10",
        }).addTo(map);

        hazardLine.bindPopup(
          `<b>${hazard.type}</b><br>Location: ${hazard.location || "Unknown"}`
        );

        incidentMarkers.push(hazardLine);
      }
    });
  } catch (error) {
    console.error("Error displaying hazards:", error);
  }
}

// Check if a hazard is near any route point
function isHazardNearRoute(hazard, routeCoordinates) {
  return routeCoordinates.some(([lat, lon]) =>
    isHazardNearPoint(hazard, lat, lon)
  );
}

function isHazardNearPoint(hazard, lat, lon) {
  const thresholdMeters = 500; // Set your desired distance threshold in meters
  const distance = haversineDistance(
    lat,
    lon,
    hazard.latitude,
    hazard.longitude
  );
  return distance < thresholdMeters;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000; // Earth's radius in meters

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distance in meters
}

// Report a hazard
async function reportHazard(type) {
  let latitude, longitude;

  if (manualLocation) {
    latitude = manualLocation.latitude;
    longitude = manualLocation.longitude;
    await sendHazardReport(type, latitude, longitude);
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
        await sendHazardReport(type, latitude, longitude);
      },
      () => {
        alert("Could not retrieve location.");
        showToast("Failed to report hazard.");
      }
    );
  } else {
    alert("Geolocation not supported.");
    showToast("Failed to report hazard.");
  }
}

// Send hazard to backend
async function sendHazardReport(type, latitude, longitude) {
  try {
    const response = await fetch("/api/hazards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, latitude, longitude }),
    });

    const data = await response.json();

    // Emit via socket
    socket.emit("send-alert", {
      type,
      latitude,
      longitude,
      message: `${type.toUpperCase()} reported at (${latitude.toFixed(
        3
      )}, ${longitude.toFixed(3)})`,
    });

    showToast(`${type.toUpperCase()} reported successfully!`);

    // Refresh hazards
    fetchAndDisplayRouteHazards(routeCoordinates);
  } catch (error) {
    console.error("Error sending hazard report:", error);
    showToast("Failed to report hazard.");
  }
}

// Handle hazard report button
function handleReport(type) {
  reportHazard(type);
}

// Handle clear
document.getElementById("clear-button").addEventListener("click", () => {
  map.eachLayer((layer) => {
    if (
      layer instanceof L.Marker ||
      layer instanceof L.Polyline ||
      layer instanceof L.CircleMarker
    ) {
      if (layer !== userMarker) map.removeLayer(layer);
    }
  });
  document.getElementById("destination").value = "";
  document.getElementById("info").innerText = "";
  routeCoordinates = [];
  incidentMarkers = [];
});

// Event bindings
document
  .getElementById("destination-form")
  .addEventListener("submit", handleDestinationSearch);

document
  .getElementById("current-location-button")
  .addEventListener("click", centerMapToCurrentLocation);

document
  .getElementById("show-route-button")
  .addEventListener("click", (event) => {
    event.preventDefault();
    handleDestinationSearch(event);
  });

// Socket alert listener
socket.on("receive-alert", (data) => {
  console.log("📥 Received alert:", data);

  // Get the user's current location
  navigator.geolocation.getCurrentPosition((position) => {
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;

    // Calculate the distance from the hazard to the user's location
    const distance = haversineDistance(
      userLat,
      userLng,
      data.latitude,
      data.longitude
    );

    const threshold = 2000; // 500 meters threshold

    // Only show the toast if the user is within the threshold distance
    if (distance <= threshold) {
      showToast(`🚨 ${data.message} (${Math.round(distance)} meters away)`);
      fetchAndDisplayRouteHazards(routeCoordinates); // Refresh hazard markers on map
    } else {
      console.log(
        `No alert: User is ${Math.round(distance)} meters away from hazard.`
      );
    }
  });
});

const destinationInput = document.getElementById("destination");
const suggestionsList = document.getElementById("suggestions-list");

// Fetch suggestions from Nominatim
async function fetchSuggestions(query) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&addressdetails=1&limit=10&countrycodes=IN`
  );
  return await response.json();
}

// Handle input changes
destinationInput.addEventListener("input", async () => {
  const query = destinationInput.value.trim();
  suggestionsList.innerHTML = "";

  if (!query) return;

  const results = await fetchSuggestions(query);

  results.forEach((place) => {
    const li = document.createElement("li");
    li.textContent = place.display_name;
    li.classList.add("suggestion-item");

    li.addEventListener("click", () => {
      destinationInput.value = place.display_name;
      suggestionsList.innerHTML = "";
    });

    suggestionsList.appendChild(li);
  });
});

// Hide suggestions on outside click
document.addEventListener("click", (e) => {
  if (!e.target.closest("#destination-form")) {
    suggestionsList.innerHTML = "";
  }
});
