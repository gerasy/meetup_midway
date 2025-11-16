import { searchAddress } from './geocoding.js';

/**
 * Calculate similarity score between two strings using Levenshtein distance
 */
function calculateStringSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.9;

    const len1 = s1.length;
    const len2 = s2.length;
    const matrix = [];

    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
}

/**
 * Score an address result based on how well it matches the query
 */
function scoreAddressMatch(query, address) {
    const queryLower = query.toLowerCase().trim();
    const displayNameLower = address.displayName.toLowerCase();

    let score = 0;

    if (displayNameLower.includes(queryLower)) {
        score += 50;
        if (displayNameLower.startsWith(queryLower)) {
            score += 20;
        }
    }

    const similarityScore = calculateStringSimilarity(queryLower, displayNameLower);
    score += similarityScore * 30;

    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const matchedWords = queryWords.filter(word => displayNameLower.includes(word));
    const wordMatchRatio = queryWords.length > 0 ? matchedWords.length / queryWords.length : 0;
    score += wordMatchRatio * 20;

    if (address.type === 'house' || address.type === 'building') {
        score += 10;
    } else if (address.type === 'road' || address.type === 'pedestrian') {
        score += 5;
    }

    if (address.address) {
        const addressStr = Object.values(address.address).join(' ').toLowerCase();
        const addressSimilarity = calculateStringSimilarity(queryLower, addressStr);
        score += addressSimilarity * 10;
    }

    return score;
}

export async function findBestAddressMatch(query) {
    if (!query || query.trim().length < 3) {
        return null;
    }

    const addresses = await searchAddress(query);

    if (addresses.length === 0) {
        return null;
    }

    const scoredAddresses = addresses.map(address => ({
        address,
        score: scoreAddressMatch(query, address)
    }));

    scoredAddresses.sort((a, b) => b.score - a.score);

    return scoredAddresses[0].address;
}

export async function autoResolveAllAddresses() {
    const inputs = Array.from(document.querySelectorAll('[data-person-input]'));
    const resolved = [];

    for (const input of inputs) {
        const label = input.dataset.personLabel || 'unknown';
        const query = (input.value || '').trim();

        if (!query) {
            continue;
        }

        const hasCoords = input.dataset.addressLat && input.dataset.addressLon;

        if (hasCoords) {
            resolved.push({
                label,
                query,
                lat: parseFloat(input.dataset.addressLat),
                lon: parseFloat(input.dataset.addressLon),
                alreadyResolved: true
            });
            continue;
        }

        try {
            const bestMatch = await findBestAddressMatch(query);

            if (bestMatch) {
                input.value = bestMatch.displayName;
                input.dataset.addressLat = bestMatch.lat;
                input.dataset.addressLon = bestMatch.lon;

                resolved.push({
                    label,
                    query: bestMatch.displayName,
                    originalQuery: query,
                    lat: bestMatch.lat,
                    lon: bestMatch.lon,
                    autoResolved: true
                });
            } else {
                resolved.push({
                    label,
                    query,
                    error: 'Could not find matching address',
                    failed: true
                });
            }
        } catch (error) {
            console.error(`Error resolving address for ${label}:`, error);
            resolved.push({
                label,
                query,
                error: error.message,
                failed: true
            });
        }
    }

    return resolved;
}
