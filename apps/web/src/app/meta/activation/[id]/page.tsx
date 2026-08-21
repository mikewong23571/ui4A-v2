'use client';
/**
 * BIOS 激活详情面:/meta/activation/<id> → meta/activation:<id>(机械 diff +
 * checks + approve/reject[RJSF,actor=human])。
 */
import { use } from 'react';

import { ActivationPageBody } from '@/components/meta/activation-view';

export default function MetaActivationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ActivationPageBody id={decodeURIComponent(id)} />;
}
