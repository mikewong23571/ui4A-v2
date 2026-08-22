import { parsePresentationRequest } from '@ui4a/shared';

import { getPresentationBroker } from '../../../engine/presentation/runtime';

export const dynamic = 'force-dynamic';

/** Shared entry for Chat, direct navigation, and Flow transitions. */
export async function POST(request: Request): Promise<Response> {
  let presentationRequest;
  try {
    presentationRequest = parsePresentationRequest(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Presentation request invalid' },
      { status: 400 },
    );
  }
  const receipt = await getPresentationBroker().present(presentationRequest);
  return Response.json(receipt);
}
