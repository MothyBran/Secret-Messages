// colorQrScanner.js

class ColorMatrixScanner {
    constructor(videoElement, canvasElement) {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });

        this.scanning = false;
        this.onScanSuccess = null;
        this.onScanError = null;

        // Colors corresponding to 00, 01, 10, 11
        this.targetColors = [
            { r: 255, g: 255, b: 255, code: '00' }, // White
            { r: 0,   g: 0,   b: 0,   code: '01' }, // Black
            { r: 255, g: 0,   b: 0,   code: '10' }, // Red
            { r: 0,   g: 0,   b: 255, code: '11' }  // Blue
        ];
    }

    start(onSuccess, onError) {
        this.onScanSuccess = onSuccess;
        this.onScanError = onError;
        this.scanning = true;
        this.scanLoop();
    }

    stop() {
        this.scanning = false;
    }

    scanLoop() {
        if (!this.scanning) return;

        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

            const result = this.decodeCurrentFrame();

            if (result && this.onScanSuccess) {
                this.onScanSuccess(result);
            } else if (this.onScanError) {
                this.onScanError("No matrix found or decode error.");
            }
        }

        // Run roughly 10 times per second
        setTimeout(() => requestAnimationFrame(() => this.scanLoop()), 100);
    }

    // Finds the closest color match using Euclidean distance
    getClosestColorCode(r, g, b) {
        let minDist = Infinity;
        let bestCode = '00';

        for (const target of this.targetColors) {
            const dr = r - target.r;
            const dg = g - target.g;
            const db = b - target.b;
            const dist = dr*dr + dg*dg + db*db;

            if (dist < minDist) {
                minDist = dist;
                bestCode = target.code;
            }
        }

        return bestCode;
    }

    // Very naive decoder for our 4-color format
    // Real-world matrix decoding needs CV algorithms to find alignment patterns,
    // perspective warp the image, and sample exactly in module centers.
    // Given the constraints and the user's specific request for a custom scanner,
    // we use jsQR (already standard-ish) to detect the corners if possible,
    // or implement a naive blob detector for the 7x7 finders.

    decodeCurrentFrame() {
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // 1. Locate Finder Patterns (3 corners: TL, TR, BL)
        // This is a highly simplified approach assuming the code is centered and relatively upright.
        // A full robust implementation requires contours finding, convex hull, and perspective transformation.

        const finders = this.findPositionPatterns(data, width, height);
        if (!finders || finders.length < 3) return null;

        // Perspective warp is skipped here for MVP; assuming axis-aligned for now
        // Or we use basic linear interpolation

        // Sort finders into TL, TR, BL
        // Sort by X + Y to get Top Left
        finders.sort((a, b) => (a.x + a.y) - (b.x + b.y));
        const tl = finders[0];

        // Remaining two are TR and BL. TR has higher X, BL has higher Y.
        let tr, bl;
        if (finders[1].x > finders[2].x) {
            tr = finders[1];
            bl = finders[2];
        } else {
            tr = finders[2];
            bl = finders[1];
        }

        // 2. Estimate Grid Size & Module Size
        const distTop = Math.sqrt(Math.pow(tr.x - tl.x, 2) + Math.pow(tr.y - tl.y, 2));
        const distLeft = Math.sqrt(Math.pow(bl.x - tl.x, 2) + Math.pow(bl.y - tl.y, 2));

        // Finder patterns are exactly 7 modules wide. We estimate module size based on finder size.
        const estimatedModuleSize = (tl.size + tr.size + bl.size) / 3 / 7;

        if (estimatedModuleSize <= 0) return null;

        const gridSize = Math.round((distTop / estimatedModuleSize) + 7);

        // Increase maximum grid size to support 500x500 super dense arrays
        if (gridSize < 21 || gridSize > 600) return null; // Invalid sizes

        // 3. Sample grid points (with basic linear interpolation, no full homography warp)
        let binaryStr = '';
        const dxTop = (tr.x - tl.x) / (gridSize - 7);
        const dyTop = (tr.y - tl.y) / (gridSize - 7);
        const dxLeft = (bl.x - tl.x) / (gridSize - 7);
        const dyLeft = (bl.y - tl.y) / (gridSize - 7);

        // Adjust starting points to top-left of the actual matrix grid.
        // We add an extra 0.5 to offset the sampling point precisely into the *center* of the module.
        const startX = tl.x - (3.5 * dxTop) - (3.5 * dxLeft) + (0.5 * dxTop) + (0.5 * dxLeft);
        const startY = tl.y - (3.5 * dyTop) - (3.5 * dyLeft) + (0.5 * dyTop) + (0.5 * dyLeft);

        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                // Skip finders
                if ((x < 8 && y < 8) || (x >= gridSize - 8 && y < 8) || (x < 8 && y >= gridSize - 8)) {
                    continue;
                }

                // Bilinear interpolation for sampling point (centered in module)
                const px = Math.round(startX + x * dxTop + y * dxLeft);
                const py = Math.round(startY + x * dyTop + y * dyLeft);

                if (px >= 0 && px < width && py >= 0 && py < height) {
                    const idx = (py * width + px) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];

                    const colorCode = this.getClosestColorCode(r, g, b);
                    binaryStr += colorCode;
                } else {
                    binaryStr += '00';
                }
            }
        }

        // 4. Decode payload
        if (binaryStr.length < 32) return null;

        // Read 32-bit length prefix
        const lenBits = binaryStr.substring(0, 32);
        const byteLen = parseInt(lenBits, 2);

        if (byteLen === 0 || byteLen > 50000) return null; // Sanity check

        const dataBits = binaryStr.substring(32, 32 + (byteLen * 8));
        if (dataBits.length < byteLen * 8) return null;

        try {
            const bytes = new Uint8Array(byteLen);
            for (let i = 0; i < byteLen; i++) {
                bytes[i] = parseInt(dataBits.substring(i * 8, (i + 1) * 8), 2);
            }

            const decoder = new TextDecoder('utf-8');
            return decoder.decode(bytes);
        } catch (e) {
            return null;
        }
    }

    findPositionPatterns(data, width, height) {
        // Fast simplified finder pattern detection
        // Looks for sequences of B-W-B-W-B (1:1:3:1:1 ratio)
        // Real implementation requires standard QR locator algorithm.
        // For MVP, since we use standard black/white finders, we mock it by scanning horizontal scanlines.

        const centers = [];
        let stateCount = [0, 0, 0, 0, 0];
        let currentState = 0;

        for (let y = 10; y < height - 10; y += 5) { // Skip by 5px for speed
            stateCount = [0, 0, 0, 0, 0];
            currentState = 0;

            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const r = data[idx], g = data[idx+1], b = data[idx+2];

                // Is black?
                const isBlack = (r < 100 && g < 100 && b < 100);

                if ((currentState === 0 && isBlack) ||
                    (currentState === 1 && !isBlack) ||
                    (currentState === 2 && isBlack) ||
                    (currentState === 3 && !isBlack) ||
                    (currentState === 4 && isBlack)) {
                    stateCount[currentState]++;
                } else {
                    if (currentState === 4) {
                        if (this.checkRatio(stateCount)) {
                            // Found horizontal pattern, estimate center and size
                            const center = this.handlePossibleCenter(stateCount, x, y, width, height, data);
                            if (center) centers.push(center);
                        }
                        currentState = 3;
                        stateCount[0] = stateCount[2];
                        stateCount[1] = stateCount[3];
                        stateCount[2] = stateCount[4];
                        stateCount[3] = 1;
                        stateCount[4] = 0;
                    } else {
                        currentState++;
                        stateCount[currentState] = 1;
                    }
                }
            }
        }

        // Cluster close centers to find the 3 true corners
        return this.clusterCenters(centers);
    }

    checkRatio(stateCount) {
        const totalFinderSize = stateCount.reduce((a, b) => a + b, 0);
        if (totalFinderSize < 7) return false;
        const moduleSize = Math.ceil(totalFinderSize / 7);
        const variance = moduleSize / 2;

        return Math.abs(moduleSize - stateCount[0]) < variance &&
               Math.abs(moduleSize - stateCount[1]) < variance &&
               Math.abs(3 * moduleSize - stateCount[2]) < 3 * variance &&
               Math.abs(moduleSize - stateCount[3]) < variance &&
               Math.abs(moduleSize - stateCount[4]) < variance;
    }

    handlePossibleCenter(stateCount, x, y, width, height, data) {
        // Mock center calc. Real JSQR does vertical and diagonal checks here.
        const center_x = x - stateCount[4] - stateCount[3] - stateCount[2] / 2;
        const totalSize = stateCount.reduce((a,b)=>a+b, 0);
        return { x: center_x, y: y, size: totalSize };
    }

    clusterCenters(centers) {
        // Group points that are close to each other
        const clusters = [];

        for (const pt of centers) {
            let found = false;
            for (const cluster of clusters) {
                const dx = pt.x - cluster.x;
                const dy = pt.y - cluster.y;
                if (Math.sqrt(dx*dx + dy*dy) < pt.size) { // Threshold
                    // Average
                    cluster.x = (cluster.x * cluster.count + pt.x) / (cluster.count + 1);
                    cluster.y = (cluster.y * cluster.count + pt.y) / (cluster.count + 1);
                    cluster.size = (cluster.size * cluster.count + pt.size) / (cluster.count + 1);
                    cluster.count++;
                    found = true;
                    break;
                }
            }
            if (!found) clusters.push({ x: pt.x, y: pt.y, size: pt.size, count: 1 });
        }

        // Sort by hits, take top 3
        clusters.sort((a,b) => b.count - a.count);
        return clusters.slice(0, 3);
    }
}

window.ColorMatrixScanner = ColorMatrixScanner;
