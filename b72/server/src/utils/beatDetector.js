const fs = require('fs');
const path = require('path');
const { fromPath } = require('pdf2pic');
const Jimp = require('jimp');
const { createCanvas, loadImage } = require('canvas');

class BeatDetector {
  constructor() {
    this.tempDir = path.join(__dirname, '../../temp');
    this.ensureTempDir();
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async pdfToImage(pdfPath, pageNumber = 1) {
    const options = {
      density: 300,
      saveFilename: `page_${pageNumber}`,
      savePath: this.tempDir,
      format: 'png',
      width: 2480,
      height: 3508
    };

    const convert = fromPath(pdfPath, options);
    const result = await convert(pageNumber, { responseType: 'image' });
    return result.path;
  }

  async preprocessImage(imagePath) {
    const image = await Jimp.read(imagePath);
    image
      .greyscale()
      .contrast(0.5)
      .normalize();

    const processedPath = imagePath.replace('.png', '_processed.png');
    await image.writeAsync(processedPath);
    return processedPath;
  }

  detectVerticalLines(imageData, width, height, threshold = 200) {
    const lines = [];
    const linePixels = new Array(width).fill(0);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const brightness = imageData[idx];
        if (brightness < threshold) {
          linePixels[x]++;
        }
      }
    }

    const minHeight = height * 0.3;
    for (let x = 0; x < width; x++) {
      if (linePixels[x] > minHeight) {
        if (lines.length === 0 || x - lines[lines.length - 1].x > 10) {
          lines.push({ x, height: linePixels[x], type: 'vertical' });
        }
      }
    }

    return lines;
  }

  detectStaffLines(imageData, width, height, threshold = 100) {
    const staffLines = [];
    const linePixels = new Array(height).fill(0);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const brightness = imageData[idx];
        if (brightness < threshold) {
          linePixels[y]++;
        }
      }
    }

    const minWidth = width * 0.5;
    let inLine = false;
    let lineStart = 0;

    for (let y = 0; y < height; y++) {
      if (linePixels[y] > minWidth) {
        if (!inLine) {
          inLine = true;
          lineStart = y;
        }
      } else {
        if (inLine) {
          inLine = false;
          const lineY = Math.floor((lineStart + y) / 2);
          staffLines.push({ y: lineY, type: 'staff' });
        }
      }
    }

    return staffLines;
  }

  detectBarLines(verticalLines, staffLines) {
    const barLines = [];
    const staffGroups = this.groupStaffLines(staffLines);

    staffGroups.forEach((group, groupIndex) => {
      const topY = group.lines[0].y;
      const bottomY = group.lines[group.lines.length - 1].y;
      const staffHeight = bottomY - topY;

      verticalLines.forEach(line => {
        if (line.height > staffHeight * 0.8) {
          barLines.push({
            x: line.x,
            y: topY - staffHeight * 0.2,
            staffIndex: groupIndex,
            staffHeight: staffHeight
          });
        }
      });
    });

    return barLines.sort((a, b) => a.x - b.x);
  }

  groupStaffLines(staffLines) {
    const groups = [];
    let currentGroup = [];

    for (let i = 0; i < staffLines.length; i++) {
      if (currentGroup.length === 0) {
        currentGroup.push(staffLines[i]);
      } else {
        const lastY = currentGroup[currentGroup.length - 1].y;
        const diff = staffLines[i].y - lastY;

        if (diff < 30 && diff > 5) {
          currentGroup.push(staffLines[i]);
        } else {
          if (currentGroup.length >= 5) {
            groups.push({ lines: [...currentGroup] });
          }
          currentGroup = [staffLines[i]];
        }
      }
    }

    if (currentGroup.length >= 5) {
      groups.push({ lines: currentGroup });
    }

    return groups;
  }

  detectTimeSignature(imageData, width, height, staffGroups) {
    let detectedTime = null;
    let detectedX = 0;
    let detectedY = 0;

    for (const group of staffGroups) {
      if (group.lines.length >= 2) {
        const topY = group.lines[0].y;
        const bottomY = group.lines[1].y;
        const midY = Math.floor((topY + bottomY) / 2);
        const searchWidth = Math.floor(width * 0.15);

        const numeralPatterns = this.detectNumerals(
          imageData, width, height, midY, searchWidth
        );

        if (numeralPatterns.length >= 2) {
          detectedTime = {
            numerator: numeralPatterns[0].value,
            denominator: numeralPatterns[1].value
          };
          detectedX = numeralPatterns[0].x;
          detectedY = midY;
          break;
        }
      }
    }

    return detectedTime || { numerator: 4, denominator: 4, x: detectedX, y: detectedY };
  }

  detectNumerals(imageData, width, height, midY, searchWidth) {
    const numerals = [];
    const templateSize = 40;

    const patterns = {
      '0': this.createNumeralPattern(0),
      '1': this.createNumeralPattern(1),
      '2': this.createNumeralPattern(2),
      '3': this.createNumeralPattern(3),
      '4': this.createNumeralPattern(4),
      '5': this.createNumeralPattern(5),
      '6': this.createNumeralPattern(6),
      '7': this.createNumeralPattern(7),
      '8': this.createNumeralPattern(8),
      '9': this.createNumeralPattern(9)
    };

    for (let x = 100; x < Math.min(searchWidth, width - 100); x += 20) {
      const window = this.extractFeatureWindow(
        imageData, width, height, x, midY - templateSize, templateSize * 2
      );

      for (const [num, pattern] of Object.entries(patterns)) {
        const similarity = this.comparePatterns(window, pattern);
        if (similarity > 0.6) {
          numerals.push({
            x,
            value: parseInt(num),
            similarity
          });
          break;
        }
      }
    }

    return numerals.sort((a, b) => a.x - b.x);
  }

  createNumeralPattern(num) {
    const patterns = {
      0: [
        [0,1,1,0],
        [1,0,0,1],
        [1,0,0,1],
        [1,0,0,1],
        [0,1,1,0]
      ],
      1: [
        [0,1,1,0],
        [1,0,1,0],
        [0,0,1,0],
        [0,0,1,0],
        [1,1,1,1]
      ],
      2: [
        [1,1,1,0],
        [0,0,0,1],
        [0,1,1,0],
        [1,0,0,0],
        [1,1,1,1]
      ],
      3: [
        [1,1,1,0],
        [0,0,0,1],
        [0,1,1,0],
        [0,0,0,1],
        [1,1,1,0]
      ],
      4: [
        [1,0,1,0],
        [1,0,1,0],
        [1,1,1,1],
        [0,0,1,0],
        [0,0,1,0]
      ],
      5: [
        [1,1,1,1],
        [1,0,0,0],
        [1,1,1,0],
        [0,0,0,1],
        [1,1,1,0]
      ],
      6: [
        [0,1,1,0],
        [1,0,0,0],
        [1,1,1,0],
        [1,0,0,1],
        [0,1,1,0]
      ],
      7: [
        [1,1,1,1],
        [0,0,0,1],
        [0,0,1,0],
        [0,1,0,0],
        [1,0,0,0]
      ],
      8: [
        [0,1,1,0],
        [1,0,0,1],
        [0,1,1,0],
        [1,0,0,1],
        [0,1,1,0]
      ],
      9: [
        [0,1,1,0],
        [1,0,0,1],
        [0,1,1,1],
        [0,0,0,1],
        [0,1,1,0]
      ]
    };
    return patterns[num] || patterns[4];
  }

  extractFeatureWindow(imageData, width, height, startX, startY, size) {
    const window = [];
    const step = Math.floor(size / 5);

    for (let i = 0; i < 5; i++) {
      const row = [];
      for (let j = 0; j < 4; j++) {
        const x = Math.min(Math.max(startX + j * step, 0), width - 1);
        const y = Math.min(Math.max(startY + i * step, 0), height - 1);
        const idx = (y * width + x) * 4;
        row.push(imageData[idx] < 128 ? 1 : 0);
      }
      window.push(row);
    }

    return window;
  }

  comparePatterns(pattern1, pattern2) {
    let matches = 0;
    const total = pattern1.length * pattern1[0].length;

    for (let i = 0; i < pattern1.length; i++) {
      for (let j = 0; j < pattern1[i].length; j++) {
        if (pattern1[i][j] === pattern2[i][j]) {
          matches++;
        }
      }
    }

    return matches / total;
  }

  generateMetronomeMarks(barLines, timeSignature, pageWidth, pageHeight) {
    const marks = [];
    const beatsPerBar = timeSignature.numerator || 4;

    if (barLines.length === 0) {
      const numBars = 8;
      const spacing = pageWidth / (numBars + 1);
      const markY = Math.floor(pageHeight * 0.15);

      for (let i = 0; i < numBars; i++) {
        const barX = (i + 1) * spacing;
        const beatSpacing = spacing / beatsPerBar;

        for (let beat = 0; beat < beatsPerBar; beat++) {
          marks.push({
            x: barX + beat * beatSpacing,
            y: markY,
            barNumber: i + 1,
            beatNumber: beat + 1,
            isAccent: beat === 0
          });
        }
      }
    } else {
      for (let i = 0; i < barLines.length - 1; i++) {
        const barStart = barLines[i].x;
        const barEnd = barLines[i + 1].x;
        const barWidth = barEnd - barStart;
        const beatSpacing = barWidth / beatsPerBar;
        const markY = barLines[i].y;

        for (let beat = 0; beat < beatsPerBar; beat++) {
          marks.push({
            x: barStart + beat * beatSpacing + beatSpacing / 2,
            y: markY - 20,
            barNumber: i + 1,
            beatNumber: beat + 1,
            isAccent: beat === 0
          });
        }
      }
    }

    return marks;
  }

  async detectBeatsFromPdf(pdfPath, pageNumber = 1) {
    try {
      const imagePath = await this.pdfToImage(pdfPath, pageNumber);
      const processedPath = await this.preprocessImage(imagePath);

      const image = await Jimp.read(processedPath);
      const width = image.bitmap.width;
      const height = image.bitmap.height;
      const imageData = image.bitmap.data;

      const verticalLines = this.detectVerticalLines(imageData, width, height);
      const staffLines = this.detectStaffLines(imageData, width, height);
      const barLines = this.detectBarLines(verticalLines, staffLines);

      const staffGroups = this.groupStaffLines(staffLines);
      const timeSignature = this.detectTimeSignature(imageData, width, height, staffGroups);
      const metronomeMarks = this.generateMetronomeMarks(barLines, timeSignature, width, height);

      const scaleFactor = 595 / width;

      fs.unlinkSync(imagePath);
      fs.unlinkSync(processedPath);

      return {
        success: true,
        timeSignature,
        barCount: barLines.length > 0 ? barLines.length - 1 : 8,
        staffCount: staffGroups.length,
        marks: metronomeMarks.map(mark => ({
          ...mark,
          x: Math.round(mark.x * scaleFactor),
          y: Math.round(mark.y * scaleFactor)
        }))
      };
    } catch (error) {
      console.error('节拍识别失败:', error);
      return {
        success: false,
        timeSignature: { numerator: 4, denominator: 4 },
        barCount: 8,
        staffCount: 2,
        marks: this.generateFallbackMarks(),
        error: error.message
      };
    }
  }

  generateFallbackMarks() {
    const marks = [];
    const numBars = 8;
    const beatsPerBar = 4;
    const spacing = 500 / (numBars + 1);

    for (let i = 0; i < numBars; i++) {
      const barX = (i + 1) * spacing;
      const beatSpacing = spacing / beatsPerBar;

      for (let beat = 0; beat < beatsPerBar; beat++) {
        marks.push({
          x: Math.round(barX + beat * beatSpacing + beatSpacing / 2),
          y: 100,
          barNumber: i + 1,
          beatNumber: beat + 1,
          isAccent: beat === 0
        });
      }
    }

    return marks;
  }
}

module.exports = BeatDetector;
