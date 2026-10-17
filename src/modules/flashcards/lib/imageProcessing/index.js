// Public surface of the flash-card image pipeline.
//
// Uploaders should import from here and never reach into the individual files:
//
//   import { prepareImage, describePreparation, comparisonOf } from "../lib/imageProcessing";
//
// The rules the pipeline enforces (see plan.js for the source of truth) are:
//
//   - an already-compressed image inside its size budget is uploaded untouched;
//   - PDF pages are rasterised once at 2x and capped at 2400 px;
//   - camera photos are capped at 2000 px; crops are never downscaled;
//   - everything is encoded to WebP once, losslessly for small crops and ink
//     previews, at the user's image_quality preset otherwise;
//   - if the browser cannot encode WebP, JPEG 0.92 (or PNG for crops / ink);
//   - every result is SHA-256 hashed so a duplicate is not uploaded twice.

export {
  IMAGE_QUALITY_NAMES,
  DEFAULT_IMAGE_QUALITY,
  QUALITY_PRESETS,
  isImageQualityName,
  resolveQualityPreset,
} from "./presets.js";

export {
  WEBP,
  JPEG,
  PNG,
  PAGE_MAX_EDGE,
  PHOTO_MAX_EDGE,
  PAGE_RENDER_SCALE,
  CROP_LOSSLESS_MAX_BYTES,
  CROP_LOSSLESS_MAX_PIXELS,
  ALREADY_COMPRESSED_MIMES,
  RASTER_MIMES,
  SOURCE_KINDS,
  maxEdgeFor,
  fitEdge,
  isRasterMime,
  pageRenderSize,
  planEncoding,
} from "./plan.js";

export { sha256Hex, hasSubtleCrypto } from "./hash.js";

export {
  encodeOnce,
  encodeWithFallback,
  fallbackFormatFor,
  FALLBACK_JPEG_QUALITY,
} from "./encode.js";

export {
  DEFAULT_ENCODE_POOL_SIZE,
  createEncodePool,
  encodeBitmap,
  terminateEncodePool,
  workersSupported,
} from "./encodePool.js";

export {
  prepareImage,
  describePreparation,
  comparisonOf,
  formatBytes,
  canEncodeOffThread,
  isBlobLike,
  isCanvasLike,
  isBitmapLike,
} from "./pipeline.js";
