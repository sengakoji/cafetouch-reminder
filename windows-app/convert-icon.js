const sharp = require('sharp');
const path = require('path');

async function convertIcon() {
    try {
        await sharp(path.join(__dirname, 'favicon.svg'))
            .resize(256, 256)
            .png()
            .toFile(path.join(__dirname, 'favicon.png'));
        console.log('Successfully converted favicon.svg to favicon.png');
    } catch (err) {
        console.error('Error converting icon:', err);
    }
}

convertIcon();
