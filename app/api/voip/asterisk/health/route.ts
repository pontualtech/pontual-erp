// =============================================================================
// app/api/voip/asterisk/health/route.ts
// =============================================================================
// GET /api/voip/asterisk/health
// Health do PBX via ARI /asterisk/info. 200 reachable, 503 unreachable.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { ariHealthcheck } from "@/lib/voip/ari-client";

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const health = await ariHealthcheck();

  if (!health.reachable) {
    return NextResponse.json(
      {
        data: {
          reachable: false,
          status: health.status,
          message: health.errorMessage ?? "ARI unreachable",
        },
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    data: {
      reachable: true,
      status: 200,
      asteriskVersion: health.asteriskVersion,
    },
  });
}