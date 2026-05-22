const CANVAS_WIDTH = 3780;
const CANVAS_HEIGHT = 2126;
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

const canvas = document.querySelector("#coverCanvas");
const ctx = canvas.getContext("2d");
const imageInput = document.querySelector("#imageInput");
const dropZone = document.querySelector("#dropZone");
const fileName = document.querySelector("#fileName");
const pasteMenu = document.querySelector("#pasteMenu");
const pasteImageButton = document.querySelector("#pasteImageButton");
const titleInput = document.querySelector("#titleInput");
const dateInput = document.querySelector("#dateInput");
const zoomInput = document.querySelector("#zoomInput");
const offsetXInput = document.querySelector("#offsetXInput");
const offsetYInput = document.querySelector("#offsetYInput");
const resetCropButton = document.querySelector("#resetCropButton");
const downloadLink = document.querySelector("#downloadLink");
const statusText = document.querySelector("#statusText");

let sourceImage = null;
let sourceObjectUrl = "";
let templateImage = null;
let renderTimer = 0;
let coverFontReady = false;
let downloadObjectUrl = "";
let exportSeq = 0;

setToday();
boot();

async function boot() {
  try {
    templateImage = await loadImage(TEMPLATE_SRC);
    drawPlaceholder();
    bindEvents();
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

  for (const element of [titleInput, dateInput, zoomInput, offsetXInput, offsetYInput]) {
    element.addEventListener("input", scheduleRender);
  }

  resetCropButton.addEventListener("click", () => {
    zoomInput.value = "1";
    offsetXInput.value = "0";
    offsetYInput.value = "0";
    scheduleRender();
  });

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
  fileName.textContent = file.name || "剪切板图片";
  scheduleRender();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    void renderCover();
  }, 60);
}

async function renderCover() {
  if (!templateImage) {
    return;
  }

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  if (sourceImage) {
    drawCoverImage();
  }

  ctx.drawImage(templateImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  if (sourceImage) {
    await ensureCoverFontLoaded();
  }
  drawText();
  void updateDownload();
}

function drawCoverImage() {
  const baseScale = Math.max(IMAGE_BOX.width / sourceImage.naturalWidth, IMAGE_BOX.height / sourceImage.naturalHeight);
  const scale = baseScale * Number(zoomInput.value);
  const drawWidth = sourceImage.naturalWidth * scale;
  const drawHeight = sourceImage.naturalHeight * scale;
  const extraX = Math.max(0, drawWidth - IMAGE_BOX.width);
  const extraY = Math.max(0, drawHeight - IMAGE_BOX.height);
  const offsetX = Number(offsetXInput.value) * extraX * 0.5;
  const offsetY = Number(offsetYInput.value) * extraY * 0.5;
  const x = IMAGE_BOX.x + (IMAGE_BOX.width - drawWidth) * 0.5 + offsetX;
  const y = IMAGE_BOX.y + (IMAGE_BOX.height - drawHeight) * 0.5 + offsetY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(IMAGE_BOX.x, IMAGE_BOX.y, IMAGE_BOX.width, IMAGE_BOX.height);
  ctx.clip();
  ctx.drawImage(sourceImage, x, y, drawWidth, drawHeight);
  ctx.restore();
}

function drawText() {
  const title = titleInput.value.trim();
  const dateText = normalizeDate(dateInput.value);

  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "top";

  if (title) {
    const titleSize = fitTitleFont(title);
    ctx.font = `${titleSize}px ChillRoundF, "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = TITLE_COLOR;
    ctx.fillText(title, TEXT_RIGHT_X, TITLE_TOP_Y);
  }

  if (dateText) {
    ctx.font = '320px ChillRoundF, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = DATE_COLOR;
    ctx.fillText(dateText, TEXT_RIGHT_X, DATE_TOP_Y);
  }

  ctx.restore();
}

function fitTitleFont(title) {
  for (let size = 145; size >= 72; size -= 4) {
    ctx.font = `${size}px ChillRoundF, "Microsoft YaHei", sans-serif`;
    if (ctx.measureText(title).width <= TITLE_MAX_WIDTH) {
      return size;
    }
  }
  return 72;
}

async function updateDownload() {
  if (!sourceImage) {
    revokeDownloadObjectUrl();
    downloadLink.classList.add("disabled");
    downloadLink.setAttribute("aria-disabled", "true");
    statusText.textContent = "等待图片";
    return;
  }

  const currentSeq = ++exportSeq;
  const title = sanitizeFilePart(titleInput.value.trim()) || "cover";
  const date = normalizeDate(dateInput.value).replaceAll("/", "_");
  const name = sanitizeFilePart(`${date} ${title}`.trim()) || "cover";
  statusText.textContent = "压缩导出";
  downloadLink.classList.add("disabled");
  downloadLink.setAttribute("aria-disabled", "true");
  const blob = await exportCoverUnderLimit();

  if (currentSeq !== exportSeq || !blob) {
    return;
  }

  revokeDownloadObjectUrl();
  downloadObjectUrl = URL.createObjectURL(blob);
  downloadLink.href = downloadObjectUrl;
  downloadLink.download = `${name}.jpg`;
  downloadLink.classList.remove("disabled");
  downloadLink.setAttribute("aria-disabled", "false");
  statusText.textContent = "生成完成";
}

function drawPlaceholder() {
  void renderCover();
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

  for (const scale of EXPORT_SCALES) {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(CANVAS_WIDTH * scale));
    exportCanvas.height = Math.max(1, Math.round(CANVAS_HEIGHT * scale));

    const exportCtx = exportCanvas.getContext("2d");
    exportCtx.imageSmoothingEnabled = true;
    exportCtx.imageSmoothingQuality = "high";
    exportCtx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);

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
