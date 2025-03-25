const mongoose = require("mongoose");

const hazardSchema = new mongoose.Schema({
  type: String, // e.g., "roadblock" or "accident"
  latitude: Number,
  longitude: Number,
  timestamp: { type: Date, default: Date.now, expires: 120 },
});

const Hazard = mongoose.model("hazards", hazardSchema);

module.exports = Hazard;
