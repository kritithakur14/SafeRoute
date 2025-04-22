
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
    stopOnFocus: true
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
  const threshold = 0.005; // ~500m
  const distance = Math.sqrt(
    Math.pow(lat - hazard.latitude, 2) + Math.pow(lon - hazard.longitude, 2)
  );
  return distance < threshold;
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
      () => alert("Could not retrieve location.")
    );
  } else {
    alert("Geolocation not supported.");
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

    // showToast(`${type.toUpperCase()} reported successfully!`);

    // Refresh hazards
    fetchAndDisplayRouteHazards(routeCoordinates);
  } catch (error) {
    console.error("Error sending hazard report:", error);
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
  showToast(`🚨 ${data.message}`);
  fetchAndDisplayRouteHazards(routeCoordinates);
});

