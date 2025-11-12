export const gtfsData = {
    stops: [],
    stopTimes: [],
    trips: [],
    routes: [],
    pathways: [],
    transfers: []
};

export const parsedData = {
    stopById: new Map(),
    stationToName: new Map(),
    stopIdToStationId: new Map(),
    stationToPlatforms: new Map(),
    rowsAtStop: new Map(),
    tripGroups: new Map(),
    tripInfo: new Map(),
    routeInfo: new Map(),
    walkEdges: new Map(),
    providedPairs: new Set(),
    grid: new Map()
};

export const appState = {
    isDataProcessed: false,
    stationLookupList: [],
    stationSearchInitialized: false
};

export function resetParsedDataCollections() {
    parsedData.stopById.clear();
    parsedData.stationToName.clear();
    parsedData.stopIdToStationId.clear();
    parsedData.stationToPlatforms.clear();
    parsedData.rowsAtStop.clear();
    parsedData.tripGroups.clear();
    parsedData.tripInfo.clear();
    parsedData.routeInfo.clear();
    parsedData.walkEdges.clear();
    parsedData.providedPairs.clear();
    parsedData.grid.clear();
}
