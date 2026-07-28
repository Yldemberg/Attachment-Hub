import { mkdir, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Request } from "express";

export class ListingImageError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ListingImageError";
  }
}

const LISTING_IMAGES_DIR =
  process.env.LISTING_IMAGES_DIR?.trim() ||
  join(process.cwd(), "data", "listing-images");

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

/** Public base URL for assets served by this API (Amazon fetches images from here). */
export function buildListingImagePublicUrl(imageId: string, req?: Request): string {
  const path = `/api/products/listing-images/${imageId}`;
  const configured = process.env.IHUB_PUBLIC_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      return `${url.origin}${path}`;
    } catch {
      return `${configured.replace(/\/$/, "")}${path}`;
    }
  }

  if (req) {
    const proto =
      (typeof req.headers["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"]
        : req.protocol) || "https";
    const host =
      (typeof req.headers["x-forwarded-host"] === "string"
        ? req.headers["x-forwarded-host"]
        : req.get("host")) ?? "localhost";
    return `${proto}://${host}${path}`;
  }

  throw new ListingImageError(
    "IHUB_PUBLIC_URL não configurada — necessária para hospedar imagens da Amazon.",
    500,
  );
}

export function isValidAmazonMediaUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function saveListingImage(
  imageBase64: string,
  mimeType = "image/jpeg",
): Promise<{ id: string; filename: string }> {
  const buffer = Buffer.from(imageBase64, "base64");
  if (!buffer.length) {
    throw new ListingImageError("Imagem vazia ou base64 inválido.");
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw new ListingImageError("Imagem muito grande. Máximo 10 MB.");
  }

  const id = randomUUID();
  const ext = extensionForMime(mimeType);
  const filename = `${id}.${ext}`;
  await mkdir(LISTING_IMAGES_DIR, { recursive: true });
  await writeFile(join(LISTING_IMAGES_DIR, filename), buffer);
  return { id, filename };
}

export async function findListingImageFile(imageId: string): Promise<{
  absolutePath: string;
  mimeType: string;
} | null> {
  if (!/^[a-f0-9-]{36}$/i.test(imageId)) return null;

  await mkdir(LISTING_IMAGES_DIR, { recursive: true });
  const entries = await readdir(LISTING_IMAGES_DIR);
  const match = entries.find((name) => name.startsWith(`${imageId}.`));
  if (!match) return null;

  const ext = match.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;

  return {
    absolutePath: join(LISTING_IMAGES_DIR, match),
    mimeType: mimeForExtension(ext),
  };
}
