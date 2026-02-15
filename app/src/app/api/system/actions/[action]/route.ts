import { NextResponse } from 'next/server';
import { invokeSystemAction } from '@/lib/server/system-api';
import type { SystemActionName } from '@/lib/system-types';

export const dynamic = 'force-dynamic';

function parseAction(value: string): SystemActionName | null {
  if (value === 'sync' || value === 'check' || value === 'backfill' || value === 'validate') {
    return value;
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const resolvedParams = await params;
  const action = parseAction(resolvedParams.action);
  if (!action) {
    return NextResponse.json(
      { error: `Unsupported action: ${resolvedParams.action}` },
      { status: 404 },
    );
  }

  let payload: unknown = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const result = await invokeSystemAction(action, payload);
  return NextResponse.json(result, { status: result.status });
}
