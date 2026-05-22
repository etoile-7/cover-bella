const CANVAS_WIDTH = 3780;
const CANVAS_HEIGHT = 2126;
const PREVIEW_SCALE = 0.5;
const IMAGE_BOX = { x: 1075, y: 211, width: 2198, height: 1227 };
const TEXT_RIGHT_X = 3276;
const TITLE_TOP_Y = 1507;
const DATE_TOP_Y = 1638;
const TITLE_MAX_WIDTH = 1500;
const TITLE_COLOR = "#eeebff";
const DATE_COLOR = "#ffffff";
const TEMPLATE_SRC = "assets/cover-template.webp";
const EXPORT_MIME = "image/jpeg";
const EXPORT_MAX_BYTES = 1 * 1024 * 1024;
const EXPORT_SCALES = [0.72, 0.64, 0.56, 0.48, 0.4, 0.34, 0.3];
const EXPORT_QUALITIES = [0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.48, 0.42];
const WHEEL_ZOOM_STEP = 0.015;
const MIN_CROP_ZOOM = 1;
const MAX_CROP_ZOOM = 3;
const SAVED_STATE_KEY = "cover-bella-state";
const IMAGE_DB_NAME = "cover-bella";
const IMAGE_STORE_NAME = "images";
const SAVED_IMAGE_KEY = "current";

const canvas = document.querySelector("#coverCanvas");
const ctx = canvas.getContext("2d");
const imageInput = document.querySelector("#imageInput");
const dropZone = document.querySelector("#dropZone");
const fileName = document.querySelector("#fileName");
const pasteMenu = document.querySelector("#pasteMenu");
const pasteImageButton = document.querySelector("#pasteImageButton");
const titleInput = document.querySelector("#titleInput");
const titleTagInputs = [...document.querySelectorAll('input[name="titleTag"]')];
const dateInput = document.querySelector("#dateInput");
const resetCropButton = document.querySelector("#resetCropButton");
const downloadLink = document.querySelector("#downloadLink");
const statusText = document.querySelector("#statusText");

let sourceImage = null;
let sourceObjectUrl = "";
let templateImage = null;
let renderFrame = 0;
let coverFontReady = false;
let downloadObjectUrl = "";
let isExporting = false;
let cropZoom = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;
let isDraggingCrop = false;
let lastDragPoint = null;
let checkedTitleTag = titleTagInputs.find((input) => input.checked) || null;

setToday();
boot();

async function boot() {
  try {
    templateImage = await loadImage(TEMPLATE_SRC);
    bindEvents();
    await restoreSavedDraft();
    drawPlaceholder();
  } catch (error) {
    statusText.textContent = "资源异常";
    console.error(error);
  }
}

function bindEvents() {
  imageInput.addEventListener("change", () => {
    const [file] = imageInput.files;
    if (file) {
      setImageFile(file);
    }
  });

  document.addEventListener("paste", (event) => {
    const file = findImageFromClipboard(event.clipboardData);
    if (!file) {
      return;
    }
    event.preventDefault();
    setImageFile(file);
  });

  dropZone.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showPasteMenu(event.clientX, event.clientY);
  });

  pasteImageButton.addEventListener("click", async () => {
    hidePasteMenu();
    await pasteImageFromClipboard();
  });

  document.addEventListener("click", hidePasteMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hidePasteMenu();
    }
  });

  for (const element of [titleInput, dateInput]) {
    element.addEventListener("input", scheduleRender);
  }

  for (const element of titleTagInputs) {
    element.addEventListener("click", () => {
      if (checkedTitleTag === element) {
        element.checked = false;
        checkedTitleTag = null;
      } else {
        checkedTitleTag = element;
      }
      scheduleRender();
    });
  }

  titleInput.addEventListener("focus", () => {
    titleInput.select();
  });

  titleInput.addEventListener("click", () => {
    titleInput.select();
  });

  resetCropButton.addEventListener("click", () => {
    resetCrop();
    scheduleRender();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (!sourceImage) {
      return;
    }
    event.preventDefault();
    canvas.focus();
    isDraggingCrop = true;
    lastDragPoint = getCanvasPoint(event);
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging-crop");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!isDraggingCrop || !lastDragPoint) {
      return;
    }
    event.preventDefault();
    const point = getCanvasPoint(event);
    cropOffsetX += point.x - lastDragPoint.x;
    cropOffsetY += point.y - lastDragPoint.y;
    lastDragPoint = point;
    clampCropOffset();
    scheduleRender();
  });

  canvas.addEventListener("pointerup", endCropDrag);
  canvas.addEventListener("pointercancel", endCropDrag);

  canvas.addEventListener("wheel", (event) => {
    if (!sourceImage || document.activeElement !== canvas) {
      return;
    }
    event.preventDefault();
    const nextZoom = clamp(cropZoom + (event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP), MIN_CROP_ZOOM, MAX_CROP_ZOOM);
    if (nextZoom === cropZoom) {
      return;
    }
    zoomCropAtPoint(nextZoom, getCanvasPoint(event));
    scheduleRender();
  }, { passive: false });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-dragging");
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    const [file] = event.dataTransfer.files;
    if (file && file.type.startsWith("image/")) {
      imageInput.files = event.dataTransfer.files;
      setImageFile(file);
    }
  });

  downloadLink.addEventListener("click", (event) => {
    event.preventDefault();
    void downloadCover();
  });
}

function showPasteMenu(x, y) {
  pasteMenu.hidden = false;
  const { width, height } = pasteMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);
  pasteMenu.style.left = `${Math.max(8, left)}px`;
  pasteMenu.style.top = `${Math.max(8, top)}px`;
}

function hidePasteMenu() {
  pasteMenu.hidden = true;
}

async function pasteImageFromClipboard() {
  try {
    const file = await readImageFromClipboard();
    if (!file) {
      statusText.textContent = "剪贴板无图片";
      return;
    }
    await setImageFile(file);
  } catch (error) {
    statusText.textContent = "无法读取剪贴板";
    console.error(error);
  }
}

async function setImageFile(file) {
  if (sourceObjectUrl) {
    URL.revokeObjectURL(sourceObjectUrl);
  }

  sourceObjectUrl = URL.createObjectURL(file);
  sourceImage = await loadImage(sourceObjectUrl);
  resetCrop();
  fileName.textContent = file.name || "剪切板图片";
  persistState();
  void saveImageBlob(file);
  scheduleRender();
}

function resetCrop() {
  cropZoom = 1;
  cropOffsetX = 0;
  cropOffsetY = 0;
}

function scheduleRender() {
  persistState();
  if (renderFrame) {
    return;
  }
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0;
    void renderPreview();
  });
}

async function renderPreview() {
  if (!templateImage) {
    return;
  }

  if (sourceImage) {
    await ensureCoverFontLoaded();
  }
  drawCover(ctx, PREVIEW_SCALE);
  updateDownloadState();
}

function drawCover(targetCtx, scale) {
  targetCtx.save();
  targetCtx.setTransform(scale, 0, 0, scale, 0, 0);
  targetCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  targetCtx.fillStyle = "#141414";
  targetCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  if (sourceImage) {
    drawCoverImage(targetCtx);
  }

  targetCtx.drawImage(templateImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawText(targetCtx);
  targetCtx.restore();
}

function drawCoverImage(targetCtx) {
  const { x, y, width, height } = getCropDrawRect();

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(IMAGE_BOX.x, IMAGE_BOX.y, IMAGE_BOX.width, IMAGE_BOX.height);
  targetCtx.clip();
  targetCtx.drawImage(sourceImage, x, y, width, height);
  targetCtx.restore();
}

function getCropDrawRect() {
  const baseScale = Math.max(IMAGE_BOX.width / sourceImage.naturalWidth, IMAGE_BOX.height / sourceImage.naturalHeight);
  const scale = baseScale * cropZoom;
  const width = sourceImage.naturalWidth * scale;
  const height = sourceImage.naturalHeight * scale;
  const offset = getClampedCropOffset(width, height);
  cropOffsetX = offset.x;
  cropOffsetY = offset.y;

  return {
    x: IMAGE_BOX.x + (IMAGE_BOX.width - width) * 0.5 + cropOffsetX,
    y: IMAGE_BOX.y + (IMAGE_BOX.height - height) * 0.5 + cropOffsetY,
    width,
    height,
  };
}

function getClampedCropOffset(width, height) {
  const maxX = Math.max(0, width - IMAGE_BOX.width) * 0.5;
  const maxY = Math.max(0, height - IMAGE_BOX.height) * 0.5;
  return {
    x: clamp(cropOffsetX, -maxX, maxX),
    y: clamp(cropOffsetY, -maxY, maxY),
  };
}

function clampCropOffset() {
  if (!sourceImage) {
    return;
  }

  const baseScale = Math.max(IMAGE_BOX.width / sourceImage.naturalWidth, IMAGE_BOX.height / sourceImage.naturalHeight);
  const width = sourceImage.naturalWidth * baseScale * cropZoom;
  const height = sourceImage.naturalHeight * baseScale * cropZoom;
  const offset = getClampedCropOffset(width, height);
  cropOffsetX = offset.x;
  cropOffsetY = offset.y;
}

function zoomCropAtPoint(nextZoom, point) {
  const oldRect = getCropDrawRect();
  const ratio = nextZoom / cropZoom;
  cropZoom = nextZoom;
  const width = oldRect.width * ratio;
  const height = oldRect.height * ratio;
  const x = point.x - (point.x - oldRect.x) * ratio;
  const y = point.y - (point.y - oldRect.y) * ratio;
  cropOffsetX = x - IMAGE_BOX.x - (IMAGE_BOX.width - width) * 0.5;
  cropOffsetY = y - IMAGE_BOX.y - (IMAGE_BOX.height - height) * 0.5;
  clampCropOffset();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
    y: (event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
  };
}

function endCropDrag(event) {
  if (!isDraggingCrop) {
    return;
  }
  isDraggingCrop = false;
  lastDragPoint = null;
  canvas.classList.remove("is-dragging-crop");
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawText(targetCtx) {
  const title = getTitleText();
  const dateText = normalizeDate(dateInput.value);

  targetCtx.save();
  targetCtx.textAlign = "right";
  targetCtx.textBaseline = "top";

  if (title) {
    const titleSize = fitTitleFont(targetCtx, title);
    targetCtx.font = `${titleSize}px ChillRoundF, "Microsoft YaHei", sans-serif`;
    targetCtx.fillStyle = TITLE_COLOR;
    targetCtx.fillText(title, TEXT_RIGHT_X, TITLE_TOP_Y);
  }

  if (dateText) {
    targetCtx.font = '320px ChillRoundF, "Microsoft YaHei", sans-serif';
    targetCtx.fillStyle = DATE_COLOR;
    targetCtx.fillText(dateText, TEXT_RIGHT_X, DATE_TOP_Y);
  }

  targetCtx.restore();
}

function fitTitleFont(targetCtx, title) {
  for (let size = 145; size >= 72; size -= 4) {
    targetCtx.font = `${size}px ChillRoundF, "Microsoft YaHei", sans-serif`;
    if (targetCtx.measureText(title).width <= TITLE_MAX_WIDTH) {
      return size;
    }
  }
  return 72;
}

function updateDownloadState() {
  if (!sourceImage) {
    revokeDownloadObjectUrl();
    downloadLink.classList.add("disabled");
    downloadLink.setAttribute("aria-disabled", "true");
    statusText.textContent = "等待图片";
    return;
  }

  if (isExporting) {
    return;
  }

  downloadLink.classList.remove("disabled");
  downloadLink.setAttribute("aria-disabled", "false");
  statusText.textContent = "预览完成";
}

async function downloadCover() {
  if (!sourceImage || isExporting) {
    return;
  }

  isExporting = true;
  downloadLink.classList.add("disabled");
  downloadLink.setAttribute("aria-disabled", "true");
  statusText.textContent = "压缩导出";

  const title = sanitizeFilePart(getTitleText()) || "cover";
  const date = normalizeDate(dateInput.value).replaceAll("/", "_");
  const name = sanitizeFilePart(`${date} ${title}`.trim()) || "cover";

  try {
    await ensureCoverFontLoaded();
    const blob = await exportCoverUnderLimit();
    if (!blob) {
      statusText.textContent = "导出失败";
      return;
    }

    revokeDownloadObjectUrl();
    downloadObjectUrl = URL.createObjectURL(blob);
    triggerDownload(downloadObjectUrl, `${name}.jpg`);
    statusText.textContent = "下载完成";
  } catch (error) {
    statusText.textContent = "导出失败";
    console.error(error);
  } finally {
    isExporting = false;
    if (sourceImage) {
      downloadLink.classList.remove("disabled");
      downloadLink.setAttribute("aria-disabled", "false");
    }
  }
}

function getTitleText() {
  const tags = titleTagInputs
    .filter((input) => input.checked)
    .map((input) => input.value)
    .join("");
  return `${tags}${titleInput.value.trim()}`;
}

async function restoreSavedDraft() {
  const saved = readSavedState();

  if (typeof saved.titleValue === "string") {
    titleInput.value = saved.titleValue;
  }

  for (const input of titleTagInputs) {
    input.checked = saved.titleTag === input.value;
  }
  checkedTitleTag = titleTagInputs.find((input) => input.checked) || null;

  cropZoom = clampNumber(saved.cropZoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM, 1);
  cropOffsetX = Number.isFinite(saved.cropOffsetX) ? saved.cropOffsetX : 0;
  cropOffsetY = Number.isFinite(saved.cropOffsetY) ? saved.cropOffsetY : 0;

  const imageBlob = await readSavedImageBlob();
  if (!imageBlob) {
    return;
  }

  if (sourceObjectUrl) {
    URL.revokeObjectURL(sourceObjectUrl);
  }
  sourceObjectUrl = URL.createObjectURL(imageBlob);
  sourceImage = await loadImage(sourceObjectUrl);
  fileName.textContent = saved.fileName || "已保存图片";
}

function readSavedState() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistState() {
  const checkedTag = titleTagInputs.find((input) => input.checked);
  const state = {
    titleValue: titleInput.value,
    titleTag: checkedTag ? checkedTag.value : "",
    cropZoom,
    cropOffsetX,
    cropOffsetY,
    fileName: sourceImage ? fileName.textContent : "",
  };
  try {
    localStorage.setItem(SAVED_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error(error);
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function drawPlaceholder() {
  void renderPreview();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }

  const matched = value.match(/(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!matched) {
    return value.trim();
  }

  const [, year, month, day] = matched;
  return `${year}/${month.padStart(2, "0")}/${day.padStart(2, "0")}`;
}

function sanitizeFilePart(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

async function exportCoverUnderLimit() {
  let fallbackBlob = null;
  const sourceCanvas = createExportSourceCanvas();

  for (const scale of EXPORT_SCALES) {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(CANVAS_WIDTH * scale));
    exportCanvas.height = Math.max(1, Math.round(CANVAS_HEIGHT * scale));

    const exportCtx = exportCanvas.getContext("2d");
    exportCtx.imageSmoothingEnabled = true;
    exportCtx.imageSmoothingQuality = "high";
    exportCtx.drawImage(sourceCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

    for (const quality of EXPORT_QUALITIES) {
      const blob = await canvasToBlob(exportCanvas, EXPORT_MIME, quality);
      if (!blob) {
        continue;
      }
      fallbackBlob = blob;
      if (blob.size <= EXPORT_MAX_BYTES) {
        return blob;
      }
    }
  }

  return fallbackBlob;
}

function createExportSourceCanvas() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = CANVAS_WIDTH;
  exportCanvas.height = CANVAS_HEIGHT;
  const exportCtx = exportCanvas.getContext("2d");
  drawCover(exportCtx, 1);
  return exportCanvas;
}

function triggerDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

function openImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(IMAGE_STORE_NAME);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveImageBlob(blob) {
  try {
    const db = await openImageDb();
    await runImageStoreTransaction(db, "readwrite", (store) => {
      store.put(blob, SAVED_IMAGE_KEY);
    });
    db.close();
  } catch (error) {
    console.error(error);
  }
}

async function readSavedImageBlob() {
  try {
    const db = await openImageDb();
    const blob = await runImageStoreTransaction(db, "readonly", (store) => store.get(SAVED_IMAGE_KEY));
    db.close();
    return blob || null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function runImageStoreTransaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE_NAME, mode);
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const request = action(store);
    let result = null;

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  });
}

function canvasToBlob(targetCanvas, mimeType, quality) {
  return new Promise((resolve) => {
    targetCanvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function revokeDownloadObjectUrl() {
  if (!downloadObjectUrl) {
    return;
  }
  URL.revokeObjectURL(downloadObjectUrl);
  downloadObjectUrl = "";
}

async function ensureCoverFontLoaded() {
  if (coverFontReady) {
    return;
  }
  statusText.textContent = "加载字体";
  await document.fonts.load("145px ChillRoundF");
  await document.fonts.load("320px ChillRoundF");
  await document.fonts.ready;
  coverFontReady = true;
}

function findImageFromClipboard(clipboardData) {
  if (!clipboardData) {
    return null;
  }

  for (const item of clipboardData.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

async function readImageFromClipboard() {
  const clipboardItems = await navigator.clipboard.read();

  for (const item of clipboardItems) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (imageType) {
      return item.getType(imageType);
    }
  }
  return null;
}

function setToday() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  dateInput.value = `${year}-${month}-${day}`;
}
