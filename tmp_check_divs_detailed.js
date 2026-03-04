const fs = require('fs');
const html = fs.readFileSync('d:/Storehouse/works/Cafetouch-Reminder/index.html', 'utf8');
const lines = html.split('\n');

let divDepth = 0;
for (let i = 970; i < 1340; i++) {
    const line = lines[i];

    let lineDelta = 0;
    const openMatches = line.match(/<div\b[^>]*>/g);
    if (openMatches) {
        divDepth += openMatches.length;
        lineDelta += openMatches.length;
    }

    const closeMatches = line.match(/<\/div>/g);
    if (closeMatches) {
        divDepth -= closeMatches.length;
        lineDelta -= closeMatches.length;
    }

    if (lineDelta !== 0 || line.trim() !== '') {
        console.log(`[Line ${i + 1}] (Depth: ${divDepth}) (Delta: ${lineDelta}) ${line.trim()}`);
    }
}
