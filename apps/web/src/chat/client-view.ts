import {
  CHAT_VIEW_PROTOCOL_VERSION,
  parseClientViewReport,
  type ClientViewReport,
  type RenderSubject,
} from '@ui4a/shared';

export interface ActivePresentationView {
  requestId: string;
  surfaceUrl: string;
}

function subjectFromSearch(search: URLSearchParams): RenderSubject | undefined {
  const focus = search.get('focus');
  if (focus !== null && focus !== '') return focus;

  const roots = search.get('roots');
  if (roots !== null) {
    const selection = roots.split(',').filter((rel) => rel !== '');
    if (selection.length > 0) return { selection };
  }

  const rel = search.get('rel');
  return rel === null || rel === '' ? undefined : rel;
}

/** Capture protocol-bearing route facts only; this function never infers display intent. */
export function clientViewReportForLocation(
  clientInstanceId: string,
  route: string,
  activePresentation?: ActivePresentationView,
): ClientViewReport {
  const url = new URL(route, 'http://ui4a.local');
  const subject = subjectFromSearch(url.searchParams);
  return parseClientViewReport({
    schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
    clientInstanceId,
    route,
    ...(subject === undefined ? {} : { subject }),
    ...(activePresentation?.surfaceUrl === route
      ? { presentationRequestId: activePresentation.requestId }
      : {}),
  });
}
