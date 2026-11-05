// FerryMapperNYC - Documented configuration constants

export const CONFIG = {
  REALTIME_URL: 'https://ferrymappernyc-live.coenen-rob.workers.dev/v1/live',

  // === Routing Algorithm ===
  MIN_TRANSFER_TIME_MIN: 5,       // Minimum transfer time between ferries (minutes)
  
  // === Data Processing ===
  STOP_MERGE_DISTANCE_M: 200,     // Merge stops within this distance (meters)
  
  // === UI Thresholds ===
  SHEET_BREAKPOINT_PX: 1024,      // Desktop/mobile breakpoint (pixels)
  FLICK_VELOCITY_THRESHOLD: 0.4,  // px/ms for flick gesture detection
  DRAG_TOGGLE_PERCENT: 35,        // % of sheet height to trigger snap toggle
  MAP_RETURN_OVERLAY_DIST_M: 5000, // meters from NYC to show "return to NYC" overlay
  
  // === Storage Keys ===
  STORAGE_KEY: 'ferryMapperNYC',
  STORAGE_KEY_STYLE: 'ferryMapperNYCStyle',
  STORAGE_KEY_LOCATION: 'ferryMapperNYCLocation',
  STORAGE_KEY_LIVE_BOATS: 'ferryMapperNYCLiveBoats',
  STORAGE_KEY_TIME_FMT: 'ferryMapperNYCTimeFmt',
  
  // === Shuttle Routes (to filter out) ===
  SHUTTLE_ROUTE_IDS: ['RES', 'RWS'],
};

export default CONFIG;
