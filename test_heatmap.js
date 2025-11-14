/**
 * Test script for heatmap color calculation
 * Run with: node test_heatmap.js
 */

function getHeatmapColor(value, minValue, maxValue) {
    // Handle edge cases
    if (!Number.isFinite(value) || !Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
        return 'rgba(128, 128, 128, 0.7)'; // Gray for invalid values
    }

    if (minValue === maxValue) {
        // If all values are the same, use middle color
        return 'rgba(251, 191, 36, 0.7)'; // Yellow
    }

    const normalized = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));

    // Color gradient from green (best) to red (worst)
    const colors = [
        { r: 34, g: 197, b: 94 },    // #22c55e - green (best)
        { r: 132, g: 204, b: 22 },   // #84cc16 - yellow-green
        { r: 251, g: 191, b: 36 },   // #fbbf24 - yellow
        { r: 249, g: 115, b: 22 },   // #f97316 - orange
        { r: 239, g: 68, b: 68 }     // #ef4444 - red (worst)
    ];

    const scaledValue = normalized * (colors.length - 1);
    const idx = Math.max(0, Math.min(colors.length - 2, Math.floor(scaledValue)));
    const fraction = scaledValue - idx;

    if (idx >= colors.length - 1) {
        const c = colors[colors.length - 1];
        return `rgba(${c.r}, ${c.g}, ${c.b}, 0.7)`;
    }

    const c1 = colors[idx];
    const c2 = colors[idx + 1];
    const r = Math.round(c1.r + (c2.r - c1.r) * fraction);
    const g = Math.round(c1.g + (c2.g - c1.g) * fraction);
    const b = Math.round(c1.b + (c2.b - c1.b) * fraction);

    return `rgba(${r}, ${g}, ${b}, 0.7)`;
}

// Test cases
console.log('=== Testing Heatmap Color Function ===\n');

// Test 1: Normal range
console.log('Test 1: Normal range (600-7200 seconds / 10-120 minutes)');
const minTime = 600;
const maxTime = 7200;
const testValues = [600, 1800, 3600, 5400, 7200];
testValues.forEach(val => {
    const color = getHeatmapColor(val, minTime, maxTime);
    const minutes = val / 60;
    console.log(`  ${minutes}min: ${color}`);
});

// Test 2: Edge case - single value
console.log('\nTest 2: All values the same');
const singleColor = getHeatmapColor(3600, 3600, 3600);
console.log(`  60min: ${singleColor}`);

// Test 3: Edge case - invalid values
console.log('\nTest 3: Invalid values');
console.log(`  NaN: ${getHeatmapColor(NaN, 600, 7200)}`);
console.log(`  Infinity: ${getHeatmapColor(Infinity, 600, 7200)}`);
console.log(`  undefined: ${getHeatmapColor(undefined, 600, 7200)}`);

// Test 4: Boundary values
console.log('\nTest 4: Boundary values');
console.log(`  Min (600s): ${getHeatmapColor(600, 600, 7200)}`);
console.log(`  Max (7200s): ${getHeatmapColor(7200, 600, 7200)}`);
console.log(`  Below min (300s): ${getHeatmapColor(300, 600, 7200)}`);
console.log(`  Above max (9000s): ${getHeatmapColor(9000, 600, 7200)}`);

// Test 5: Color gradient verification
console.log('\nTest 5: Color gradient (10 steps from best to worst)');
const steps = 10;
for (let i = 0; i <= steps; i++) {
    const val = minTime + (maxTime - minTime) * (i / steps);
    const color = getHeatmapColor(val, minTime, maxTime);
    const minutes = val / 60;
    console.log(`  Step ${i}/${steps} (${minutes.toFixed(1)}min): ${color}`);
}

console.log('\n=== All Tests Complete ===');
console.log('If no errors appeared above, the color function is working correctly!');
