import { NextResponse } from 'next/server';
import { buildSystemSnapshot } from '@/lib/server/system-api';
import type { SystemSnapshotResponse } from '@/lib/system-types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { snapshot, live, warning } = await buildSystemSnapshot();
  const response: SystemSnapshotResponse = {
    live,
    snapshot,
    warning,
  };
  return NextResponse.json(response, { status: 200 });
}
