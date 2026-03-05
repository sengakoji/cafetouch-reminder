const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');

async function createSilhouetteIcon() {
    console.log("Loading source image...");
    const srcPath = path.join(__dirname, 'www', 'favicon-96x96.png');

    if (!fs.existsSync(srcPath)) {
        console.error("Source image not found:", srcPath);
        process.exit(1);
    }

    try {
        const image = await loadImage(srcPath);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');

        ctx.drawImage(image, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Convert non-transparent pixels to solid white
        for (let i = 0; i < data.length; i += 4) {
            // data[i+3] is the alpha channel
            if (data[i + 3] > 0) {
                data[i] = 255;     // R
                data[i + 1] = 255; // G
                data[i + 2] = 255; // B
                // Keep the original alpha
            }
        }

        ctx.putImageData(imageData, 0, 0);

        // Save to Android drawable directory
        const destDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res', 'drawable');
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        const destPath = path.join(destDir, 'ic_stat_icon.png');
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(destPath, buffer);

        console.log(`Successfully created silhouette icon at: ${destPath}`);
    } catch (e) {
        console.error("Failed to process image:", e);
        process.exit(1);
    }
}

createSilhouetteIcon();
