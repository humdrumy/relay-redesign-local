export const ROOK_MENTION = '<@U0C9ZFB8FQA>';
export const ROOK_PREFIX = `${ROOK_MENTION} `;
export const SLACK_MESSAGE_VIEW_LIMIT = 4000 + ROOK_PREFIX.length;

export function withRookMention(text) {
  return text.startsWith(ROOK_PREFIX) ? text : `${ROOK_PREFIX}${text}`;
}
