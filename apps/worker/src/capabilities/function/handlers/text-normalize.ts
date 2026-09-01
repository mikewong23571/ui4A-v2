import type { NativeFunctionHandler } from '../adapter';

export const normalizeReferenceText: NativeFunctionHandler = async (payload) => {
  const text = payload.text;
  if (typeof text !== 'string') throw new Error('text is required');
  return { output: { text: text.trim().replace(/\s+/gu, ' ') } };
};
