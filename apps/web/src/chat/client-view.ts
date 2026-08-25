import {
  CHAT_VIEW_PROTOCOL_VERSION,
  parseClientViewReport,
  type ClientViewReport,
} from '@ui4a/shared';

import { latestPresenceSeq, presenceObservationForLocation } from '@/presence/client';

export interface ActivePresentationView {
  requestId: string;
  surfaceUrl: string;
}

/** Capture protocol-bearing route facts only; this function never infers display intent. */
export function clientViewReportForLocation(
  clientInstanceId: string,
  route: string,
  activePresentation?: ActivePresentationView,
): ClientViewReport {
  const observation = presenceObservationForLocation(route);
  return parseClientViewReport({
    schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
    presence: {
      clientInstanceId,
      site: observation.site,
      scope: observation.scope,
      thread: observation.thread,
      focus: observation.focus,
      ...(latestPresenceSeq() === undefined ? {} : { presenceSeq: latestPresenceSeq() }),
      ...(activePresentation?.surfaceUrl === route
        ? { presentationRequestId: activePresentation.requestId }
        : {}),
    },
  });
}
