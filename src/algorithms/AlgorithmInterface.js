/**
 * Base interface for A→B routing algorithms
 * All routing algorithms must implement this interface
 */
export class AlgorithmInterface {
    /**
     * Get the name of this algorithm
     * @returns {string}
     */
    getName() {
        throw new Error('Method getName() must be implemented');
    }

    /**
     * Get a description of this algorithm
     * @returns {string}
     */
    getDescription() {
        throw new Error('Method getDescription() must be implemented');
    }

    /**
     * Search for routes from A to B
     * @param {Object} params - Search parameters
     * @param {Object} params.startPoint - Starting location {query, isAddress, lat, lon}
     * @param {Object} params.endPoint - Destination location {query, isAddress, lat, lon}
     * @param {number} params.startTimeSec - Departure time in seconds since midnight
     * @param {number} [params.maxRoutes=3] - Maximum number of routes to return
     * @returns {Promise<Array>} Array of route objects
     *
     * Route object format:
     * {
     *   totalTime: number,        // Total travel time in seconds
     *   arrivalTime: number,      // Arrival time in seconds since midnight
     *   path: Array,              // Array of step objects
     *   startStopId: string,      // Starting stop ID
     *   destStopId: string        // Destination stop ID
     * }
     *
     * Step object format:
     * {
     *   mode: string,             // 'WALK' or 'TRANSIT'
     *   from_stop: string,        // Origin stop ID
     *   to_stop: string,          // Destination stop ID
     *   depart_sec: number,       // Departure time
     *   arrive_sec: number,       // Arrival time
     *   // For TRANSIT steps:
     *   trip_id: string,          // Trip ID
     *   route_short_name: string, // Route name/number
     *   trip_headsign: string,    // Direction/headsign
     *   board_sec: number,        // Boarding time
     *   alight_sec: number,       // Alighting time
     *   // For WALK steps:
     *   walk_sec: number,         // Walking duration
     *   distance_m: number        // Walking distance in meters
     * }
     */
    async searchRoutes(params) {
        throw new Error('Method searchRoutes() must be implemented');
    }

    /**
     * Get performance statistics about the last search
     * @returns {Object|null} Statistics object or null if no search has been performed
     */
    getStats() {
        return null;
    }
}
