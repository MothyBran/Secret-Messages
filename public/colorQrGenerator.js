class ColorMatrixGenerator {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.width = options.width || 300;
        this.height = options.height || 300;

        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.colors = {
            '00': '#FFFFFF', // White
            '01': '#000000', // Black
            '10': '#FF0000', // Red
            '11': '#0000FF'  // Blue
        };
    }

    textToBinary(text) {
        const encoder = new TextEncoder();
        const uint8array = encoder.encode(text);

        let binary = '';
        for (let i = 0; i < uint8array.length; i++) {
            binary += uint8array[i].toString(2).padStart(8, '0');
        }
        return binary;
    }

    getPairs(text) {
        const binaryData = this.textToBinary(text);

        // Pad binary to ensure even length
        const paddedBinary = binaryData.length % 2 === 0 ? binaryData : binaryData + '0';

        const dataPairs = [];
        for (let i = 0; i < paddedBinary.length; i += 2) {
            dataPairs.push(paddedBinary.substring(i, i + 2));
        }

        // Add 32-bit length prefix (number of bytes)
        const byteLen = Math.ceil(paddedBinary.length / 8);
        const byteLenBin = byteLen.toString(2).padStart(32, '0');

        const allPairs = [];
        for (let i=0; i<32; i+=2) allPairs.push(byteLenBin.substring(i, i+2));
        allPairs.push(...dataPairs);
        return allPairs;
    }

    computeGridSize(text) {
        const allPairs = this.getPairs(text);
        let gridSize = 21;
        while(true) {
            const totalModules = gridSize * gridSize;
            // 3 finders of 8x8 blocks = 192 modules
            const availableModules = totalModules - 192;
            if(availableModules >= allPairs.length) break;
            gridSize += 4; // Step by 4 to avoid overly dense scaling jumps
        }
        return gridSize;
    }

    generate(text, options = {}) {
        // Clear canvas with white
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(0, 0, this.width, this.height);

        const allPairs = this.getPairs(text);

        // Determine grid size
        let gridSize = options.fixedGridSize || this.computeGridSize(text);

        // Define padding inside canvas
        const canvasPadding = 10;
        const availableWidth = this.width - (canvasPadding * 2);
        // Force moduleSize to be at least 1, even if it exceeds the desired canvas width.
        // If the payload is too massive, the canvas must stretch to fit it.
        const moduleSize = Math.max(1, Math.floor(availableWidth / gridSize));

        // If the required width exceeds the canvas setting, resize the canvas dynamically
        const requiredWidth = (moduleSize * gridSize) + (canvasPadding * 2);
        if (requiredWidth > this.canvas.width) {
            this.canvas.width = requiredWidth;
            this.canvas.height = requiredWidth;
            this.width = requiredWidth;
            this.height = requiredWidth;

            // Re-clear since we resized
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillRect(0, 0, this.width, this.height);
        }

        // Center the matrix inside the canvas
        const matrixWidth = moduleSize * gridSize;
        const offsetX = Math.floor((this.width - matrixWidth) / 2);
        const offsetY = Math.floor((this.height - matrixWidth) / 2);

        // 1. Draw Data Modules (Background fill first, to avoid overlaps)
        let dataIndex = 0;

        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                // Skip the 8x8 corner areas reserved for finder patterns
                if ((x < 8 && y < 8) ||
                    (x >= gridSize - 8 && y < 8) ||
                    (x < 8 && y >= gridSize - 8)) {
                    continue;
                }

                let colorCode = '00'; // Default White padding
                if (dataIndex < allPairs.length) {
                    colorCode = allPairs[dataIndex];
                    dataIndex++;
                }

                this.ctx.fillStyle = this.colors[colorCode];
                // Overdraw slightly (0.5) to prevent anti-aliasing seams at tiny sizes
                this.ctx.fillRect(offsetX + x * moduleSize, offsetY + y * moduleSize, moduleSize + 0.5, moduleSize + 0.5);
            }
        }

        // 2. Draw Finder Patterns (Top-Left, Top-Right, Bottom-Left)
        // Ensure they exactly match QR standard 7x7 markers
        this.drawFinder(offsetX, offsetY, moduleSize);
        this.drawFinder(offsetX + (gridSize - 7) * moduleSize, offsetY, moduleSize);
        this.drawFinder(offsetX, offsetY + (gridSize - 7) * moduleSize, moduleSize);

        return { gridSize, moduleSize, offsetX, offsetY };
    }

    drawFinder(x, y, ms) {
        // Outer 7x7 Black square
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(x, y, ms * 7, ms * 7);
        // Inner 5x5 White square
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(x + ms, y + ms, ms * 5, ms * 5);
        // Core 3x3 Black square
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(x + ms * 2, y + ms * 2, ms * 3, ms * 3);
    }
}

// Export to window for global access
window.ColorMatrixGenerator = ColorMatrixGenerator;
