const fs = require('fs');
const html = fs.readFileSync('d:/Storehouse/works/Cafetouch-Reminder/index.html', 'utf8');
const lines = html.split('\n');

let divDepth = 0;
let inSettingsContent = false;
let settingsContentDepth = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('class="settings-content"')) {
        inSettingsContent = true;
        settingsContentDepth = divDepth;
        console.log(`[Line ${i + 1}] ${divDepth} OPENS settings-content: ${line.trim()}`);
    }

    // Count <div...>
    const openMatches = line.match(/<div\b[^>]*>/g);
    if (openMatches) {
        divDepth += openMatches.length;
    }

    // Count </div>
    const closeMatches = line.match(/<\/div>/g);
    if (closeMatches) {
        divDepth -= closeMatches.length;
        if (inSettingsContent && divDepth === settingsContentDepth) {
            console.log(`[Line ${i + 1}] ${divDepth} CLOSES settings-content! Line: ${line.trim()}`);
            inSettingsContent = false;
            // Print the next 5 lines for context
            for (let j = 1; j <= 5; j++) {
                if (i + j < lines.length) console.log(`  +${j}: ${lines[i + j].trim()}`);
            }
        }
    }
}
