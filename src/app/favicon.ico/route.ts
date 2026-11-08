import { appIconSvg } from "../icon-artwork";

export function GET() {
  return new Response(appIconSvg, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": "image/svg+xml",
    },
  });
}

