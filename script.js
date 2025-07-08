const imageInput = document.getElementById('imageInput');
const removeBtn = document.getElementById('removeBtn');
const downloadBtn = document.getElementById('downloadBtn');
const removeCursorBtn = document.getElementById('removeCursorBtn');
const restoreCursorBtn = document.getElementById('restoreCursorBtn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const brushSizeSlider = document.getElementById('brushSizeSlider');
const brushSizeValue = document.getElementById('brushSizeValue');

const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 100; // Limit to prevent memory issues

let image = new Image();
let imageLoaded = false;
let originalImageData = null;
let mode = null; // "remove", "restore"
let drawing = false;
let brushSize = 24;

let originalFileName = 'image'; // fallback

document.getElementById('themeToggle').addEventListener('change', function(e) {
  document.body.classList.toggle('light', e.target.checked);
});



imageInput.addEventListener('change', function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (evt) {
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
      imageLoaded = true;
      removeBtn.disabled = false;
      removeCursorBtn.disabled = false;
      restoreCursorBtn.disabled = false;
        originalFileName = file.name.split('.').slice(0, -1).join('.') || 'image'; // remove extension

      // Save a copy of the original for restore, only ONCE
      originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    };
    image.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});



canvas.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvas.style.border = "2px dashed #aaa"; // Optional visual cue
});

canvas.addEventListener('dragleave', (e) => {
  e.preventDefault();
  canvas.style.border = "none";
});

canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  canvas.style.border = "none";

  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = function (evt) {
      image.onload = () => {
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
        imageLoaded = true;
        removeBtn.disabled = false;
        removeCursorBtn.disabled = false;
        restoreCursorBtn.disabled = false;
        magicWandBtn.disabled = false;
        originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        updateUndoRedoButtons();
      };
      image.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }
});


// Sample several background points (corners, edges)
function sampleBackgroundColors(data, width, height) {
  const positions = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
    { x: Math.floor(width / 2), y: 0 },
    { x: 0, y: Math.floor(height / 2) },
    { x: width - 1, y: Math.floor(height / 2) },
    { x: Math.floor(width / 2), y: height - 1 },
  ];
  return positions.map(pos => {
    const idx = (pos.y * width + pos.x) * 4;
    return [data[idx], data[idx + 1], data[idx + 2]];
  });
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rmean = (r1 + r2) / 2;
  const r = r1 - r2;
  const g = g1 - g2;
  const b = b1 - b2;
  return Math.sqrt((((512 + rmean) * r * r) >> 8) + 4 * g * g + (((767 - rmean) * b * b) >> 8));
}

function floodFillRemove(imgData, width, height, bgColors, threshold) {
  const data = imgData.data;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const starts = [
    { x: 0, y: 0 }, { x: width - 1, y: 0 },
    { x: 0, y: height - 1 }, { x: width - 1, y: height - 1 },
    { x: Math.floor(width / 2), y: 0 },
    { x: 0, y: Math.floor(height / 2) },
    { x: width - 1, y: Math.floor(height / 2) },
    { x: Math.floor(width / 2), y: height - 1 }
  ];
  starts.forEach(({x, y}) => stack.push({x, y}));

  while(stack.length) {
    const {x, y} = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = (y * width + x);
    if (visited[idx]) continue;
    visited[idx] = 1;

    const i = idx * 4;
    const r = data[i], g = data[i+1], b = data[i+2];
    let isBg = false;
    for (const [br, bg, bb] of bgColors) {
      if (colorDistance(r, g, b, br, bg, bb) < threshold) {
        isBg = true;
        break;
      }
    }
    if (isBg) {
      data[i+3] = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx !== 0 || dy !== 0) {
            stack.push({x: x+dx, y: y+dy});
          }
        }
      }
    }
  }
  expandTransparency(data, width, height, 2);
}

function expandTransparency(data, width, height, n) {
  const alphaMask = new Uint8Array(width * height);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] === 0) alphaMask[y * width + x] = 1;
    }
  }
  for (let pass = 0; pass < n; ++pass) {
    const newMask = alphaMask.slice();
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        if (alphaMask[y * width + x]) continue;
        outer: for (let dy = -1; dy <= 1; ++dy) {
          for (let dx = -1; dx <= 1; ++dx) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (alphaMask[ny * width + nx]) {
                newMask[y * width + x] = 1;
                break outer;
              }
            }
          }
        }
      }
    }
    alphaMask.set(newMask);
  }
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      if (alphaMask[y * width + x]) {
        const idx = (y * width + x) * 4;
        data[idx + 3] = 0;
      }
    }
  }
}

// Magic Wand functionality
const magicWandBtn = document.getElementById('magicWandBtn');

magicWandBtn.addEventListener('click', () => {
  mode = "magic";
  canvas.style.cursor = "crosshair";
});

// Smart Restore functionality
const magicRestoreBtn = document.getElementById('magicRestoreBtn');

magicRestoreBtn.addEventListener('click', () => {
  mode = "smart-restore";
  canvas.style.cursor = "crosshair";
});




function saveState() {
  if (undoStack.length >= MAX_HISTORY) {
    undoStack.shift();
  }
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  redoStack.length = 0;
  updateUndoRedoButtons(); // <--- ADD THIS
}


function undo() {
  if (undoStack.length === 0) return;
  const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  redoStack.push(current);
  const previous = undoStack.pop();
  ctx.putImageData(previous, 0, 0);
}

function redo() {
  if (redoStack.length === 0) return;
  const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  undoStack.push(current);
  const next = redoStack.pop();
  ctx.putImageData(next, 0, 0);
}
// Undo/Redo functionality

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

undoBtn.addEventListener('click', () => {
  undo();
  updateUndoRedoButtons();
});

redoBtn.addEventListener('click', () => {
  redo();
  updateUndoRedoButtons();
});



function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}
updateUndoRedoButtons();


removeBtn.addEventListener('click', function () {
  if (!imageLoaded) return;
  saveState(); // <--- ADD THIS
  ctx.drawImage(image, 0, 0);
  let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bgColors = sampleBackgroundColors(imgData.data, canvas.width, canvas.height);
  const threshold = 75;
  floodFillRemove(imgData, canvas.width, canvas.height, bgColors, threshold);
  ctx.putImageData(imgData, 0, 0);
  downloadBtn.href = canvas.toDataURL('image/png');
  downloadBtn.download = `${originalFileName}-no-bg.png`;
  downloadBtn.style.display = '';
});


// Brush size slider functionality

brushSizeSlider.addEventListener('input', function () {
  brushSize = parseInt(brushSizeSlider.value, 10);
  brushSizeValue.textContent = brushSize;
});
// --- Cursor remove/restore functionality ---

removeCursorBtn.addEventListener('click', () => {
  mode = "remove";
  canvas.style.cursor = "crosshair";
});

restoreCursorBtn.addEventListener('click', () => {
  mode = "restore";
  canvas.style.cursor = "crosshair";
});

canvas.addEventListener('mousedown', function(e) {
  if (!mode) return;
  drawing = true;
  handleDraw(e);
});

canvas.addEventListener('mousemove', function(e) {
  if (!drawing || !mode) return;
  handleDraw(e);
});

canvas.addEventListener('mouseup', function() {
  drawing = false;
});

canvas.addEventListener('mouseleave', function() {
  drawing = false;
});

canvas.addEventListener('touchstart', function (e) {
  if (!mode) return;
  e.preventDefault();
  drawing = true;
  handleTouch(e);
}, { passive: false });

canvas.addEventListener('touchmove', function (e) {
  if (!drawing || !mode) return;
  e.preventDefault();
  handleTouch(e);
}, { passive: false });

canvas.addEventListener('touchend', function () {
  drawing = false;
});

canvas.addEventListener('touchcancel', function () {
  drawing = false;
});



function handleTouch(e) {
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((touch.clientX - rect.left) * (canvas.width / rect.width));
  const y = Math.round((touch.clientY - rect.top) * (canvas.height / rect.height));
  if (mode === "remove") {
    eraseAt(x, y);
  } else if (mode === "restore") {
    restoreAt(x, y);
  } else if (mode === "magic") {
    saveState();
    smartRemoveAt(x, y);
  } else if (mode === "smart-restore") {
    saveState();
    smartRestoreAt(x, y);
  }
  downloadBtn.href = canvas.toDataURL('image/png');
  downloadBtn.download = `${originalFileName}-no-bg.png`;
  downloadBtn.style.display = '';
}


function handleDraw(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
  const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));

  if (mode === "remove") {
    eraseAt(x, y);
  } else if (mode === "restore") {
    restoreAt(x, y);
  } else if (mode === "magic") {
    saveState();
    smartRemoveAt(x, y);
  }else if (mode === "smart-restore") {
    saveState();
    smartRestoreAt(x, y);
  }

  downloadBtn.href = canvas.toDataURL('image/png');
  downloadBtn.download = `${originalFileName}-no-bg.png`;
  downloadBtn.style.display = '';
}



function eraseAt(x, y) {
  saveState();
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  for (let dy = -brushSize; dy <= brushSize; ++dy) {
    for (let dx = -brushSize; dx <= brushSize; ++dx) {
      if (dx * dx + dy * dy <= brushSize * brushSize) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
          const idx = (ny * canvas.width + nx) * 4 + 3;
          data[idx] = 0;
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function smartRemoveAt(startX, startY) {
  const threshold = 75; // You can make this adjustable
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const width = canvas.width;
  const height = canvas.height;
  const visited = new Uint8Array(width * height);
  const stack = [{ x: startX, y: startY }];
  const startIdx = (startY * width + startX) * 4;
  const sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2];

  while (stack.length) {
    const { x, y } = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const i = idx * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];

    if (colorDistance(r, g, b, sr, sg, sb) < threshold) {
      data[i + 3] = 0; // make transparent

      // Push neighbors
      stack.push({ x: x + 1, y: y });
      stack.push({ x: x - 1, y: y });
      stack.push({ x: x, y: y + 1 });
      stack.push({ x: x, y: y - 1 });
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

function smartRestoreAt(startX, startY) {
  if (!originalImageData) return;

  const threshold = 75; // Adjustable threshold
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const orig = originalImageData.data;

  const width = canvas.width;
  const height = canvas.height;
  const visited = new Uint8Array(width * height);
  const stack = [{ x: startX, y: startY }];

  const startIdx = (startY * width + startX) * 4;
  const sr = orig[startIdx], sg = orig[startIdx + 1], sb = orig[startIdx + 2];

  while (stack.length) {
    const { x, y } = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;

    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const i = idx * 4;
    const r = orig[i], g = orig[i + 1], b = orig[i + 2];

    // Compare with original image's selected color
    if (colorDistance(r, g, b, sr, sg, sb) < threshold) {
      // Restore from original
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = orig[i + 3];

      // Push neighbors
      stack.push({ x: x + 1, y: y });
      stack.push({ x: x - 1, y: y });
      stack.push({ x: x, y: y + 1 });
      stack.push({ x: x, y: y - 1 });
    }
  }

  ctx.putImageData(imgData, 0, 0);
}



function restoreAt(x, y) {
  if (!originalImageData) return;
  saveState();
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const orig = originalImageData.data;
  for (let dy = -brushSize; dy <= brushSize; ++dy) {
    for (let dx = -brushSize; dx <= brushSize; ++dx) {
      if (dx * dx + dy * dy <= brushSize * brushSize) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
          const idx = (ny * canvas.width + nx) * 4;
          data[idx] = orig[idx];
          data[idx+1] = orig[idx+1];
          data[idx+2] = orig[idx+2];
          data[idx+3] = orig[idx+3];
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}


downloadBtn.addEventListener('click', function () {
  // Download handled by setting href as data URL

});

document.addEventListener('keydown', function (e) {
  if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
    e.preventDefault(); // Prevent browser undo
    undo();
    updateUndoRedoButtons();
  } else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
    // Ctrl+Y or Ctrl+Shift+Z for Redo
    e.preventDefault(); // Prevent browser redo
    redo();
    updateUndoRedoButtons();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("service-worker.js")
    .then(() => console.log("✅ Service Worker registered"))
    .catch(err => console.error("⚠️ SW registration failed:", err));
}
