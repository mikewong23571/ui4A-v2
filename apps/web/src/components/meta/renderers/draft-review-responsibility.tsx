import type { MetaNavigationContext } from '../meta-navigation';
import type { DraftReviewResponsibility } from '../view-models/draft-review-responsibility';
import { browserHrefForContractHref } from './common';

export function DraftResponsibility({
  responsibility,
  navigation,
}: {
  responsibility: DraftReviewResponsibility;
  navigation: MetaNavigationContext;
}) {
  const repairHref =
    responsibility.repairLink === undefined
      ? null
      : browserHrefForContractHref(responsibility.repairLink.href, navigation);

  return (
    <section
      aria-labelledby="draft-review-responsibility-heading"
      className="rounded-xl border bg-muted/20 p-4"
    >
      <h2 id="draft-review-responsibility-heading" className="text-lg font-semibold">
        审查责任点
      </h2>
      <p className="mt-2 font-medium">{responsibility.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{responsibility.description}</p>
      {responsibility.repairLink !== undefined && repairHref !== null && (
        <a
          href={repairHref}
          className="mt-3 inline-flex text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {responsibility.repairLink.title}
        </a>
      )}
    </section>
  );
}
