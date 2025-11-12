export function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) {
        return [];
    }
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === headers.length) {
            const obj = {};
            headers.forEach((header, idx) => {
                obj[header] = values[idx];
            });
            data.push(obj);
        }
    }

    return data;
}

export function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

export function toSeconds(hms) {
    if (!hms) return null;
    const match = hms.match(/^(\d+):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, hStr, mStr, sStr] = match;
    const h = Number(hStr);
    const m = Number(mStr);
    const s = Number(sStr);
    return h * 3600 + m * 60 + s;
}

export function sec2hm(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatMinutes(seconds) {
    const minutes = seconds / 60;
    if (Math.abs(minutes - Math.round(minutes)) < 1e-6) {
        return `${Math.round(minutes)} min`;
    }
    return `${minutes.toFixed(1)} min`;
}
