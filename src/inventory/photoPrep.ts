// Phone photos carry EXIF, often including GPS coordinates of the house.
// Giveaway photos are public, so every upload is redrawn through a canvas,
// which keeps the pixels and drops all metadata. Large photos are scaled down
// at the same time, which also makes uploads and AI enrichment faster.
const MAX_EDGE = 2560;
const JPEG_QUALITY = 0.9;

// A full-resolution phone photo decodes to ~50 MB. Preparing several at once
// can kill a mobile tab, so photos go through one at a time.
let queue: Promise<unknown> = Promise.resolve();

export function preparePhotoForUpload(file: File): Promise<Blob> {
  const next = queue.then(() => preparePhoto(file));
  queue = next.catch(() => undefined);
  return next;
}

async function preparePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name || "A photo"} could not be read. Try taking the photo again as a JPEG.`);
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the photo.");
    // JPEG has no transparency, so give PNG/WebP a white background, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("This browser could not prepare the photo.");
    return blob;
  } finally {
    bitmap.close();
  }
}
