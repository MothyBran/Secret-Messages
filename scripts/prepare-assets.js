const fs = require('fs');
const path = require('path');

/**
 * ASSET PREPARATION
 * Copies required external libraries (like Chart.js, FontAwesome) from node_modules to public/assets.
 * This ensures the application works offline/locally (Enterprise requirement).
 */

async function prepareAssets() {
    console.log("📦 Preparing Frontend Assets...");

    const nodeModulesPath = path.join(__dirname, '../node_modules');
    const publicAssetsJs = path.join(__dirname, '../public/assets/js');
    const publicAssetsCss = path.join(__dirname, '../public/assets/css');
    const publicAssetsWebfonts = path.join(__dirname, '../public/assets/webfonts');

    // Ensure dirs exist
    const dirs = [publicAssetsJs, publicAssetsCss, publicAssetsWebfonts];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    // Define Assets to Copy
    const assets = [
        // Chart.js
        {
            src: path.join(nodeModulesPath, 'chart.js/dist/chart.umd.js'),
            dest: path.join(publicAssetsJs, 'chart.js'),
            name: 'Chart.js'
        },
        // FontAwesome CSS
        {
            src: path.join(nodeModulesPath, '@fortawesome/fontawesome-free/css/all.min.css'),
            dest: path.join(publicAssetsCss, 'all.min.css'),
            name: 'FontAwesome CSS'
        }
    ];

    // FontAwesome Webfonts (Directory Copy)
    const faFontsSrc = path.join(nodeModulesPath, '@fortawesome/fontawesome-free/webfonts');

    let successCount = 0;
    const totalTasks = assets.length + 1; // +1 for webfonts

    // 1. Copy Files
    for (const asset of assets) {
        if (fs.existsSync(asset.src)) {
            try {
                fs.copyFileSync(asset.src, asset.dest);
                console.log(`   ✅ Copied ${asset.name} -> ${path.relative(path.join(__dirname, '..'), asset.dest)}`);
                successCount++;
            } catch (e) {
                console.error(`   ❌ Failed to copy ${asset.name}:`, e.message);
            }
        } else {
            console.warn(`   ⚠️ Source not found for ${asset.name}: ${asset.src}`);
        }
    }

    // 2. Copy Webfonts
    if (fs.existsSync(faFontsSrc)) {
        try {
            const fontFiles = fs.readdirSync(faFontsSrc);
            let fontsCopied = 0;
            fontFiles.forEach(file => {
                const srcFile = path.join(faFontsSrc, file);
                const destFile = path.join(publicAssetsWebfonts, file);
                fs.copyFileSync(srcFile, destFile);
                fontsCopied++;
            });
            console.log(`   ✅ Copied FontAwesome Webfonts (${fontsCopied} files) -> public/assets/webfonts`);
            successCount++;
        } catch (e) {
            console.error(`   ❌ Failed to copy Webfonts:`, e.message);
        }
    } else {
         console.warn(`   ⚠️ FontAwesome Webfonts source not found at ${faFontsSrc}`);
    }


    if (successCount === totalTasks) {
        console.log("✅ All assets prepared.");
    } else {
        console.warn(`⚠️ Only ${successCount}/${totalTasks} asset tasks completed.`);
    }
}

if (require.main === module) {
    prepareAssets();
}

module.exports = prepareAssets;
