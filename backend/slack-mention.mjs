export const SLACK_ACTOR_IDS = Object.freeze({ dot: 'U0C6PAA9PT5', scout: 'U0C9ZFB8FQA' });
export const ROOK_MENTION = `<@${SLACK_ACTOR_IDS.scout}>`;
export const ROOK_PREFIX = `${ROOK_MENTION} `;
export const SLACK_MESSAGE_VIEW_LIMIT = 4000 + `<@${SLACK_ACTOR_IDS.dot}> <@${SLACK_ACTOR_IDS.scout}> `.length;

export function withActorMentions(text, actors) {
  const prefix = [...new Set(actors)].map(actor => SLACK_ACTOR_IDS[actor]).filter(Boolean).map(id => `<@${id}>`).join(' ');
  return prefix ? `${prefix} ${text}` : text;
}

export function legacyTextAlternatives(text) {
  const bare = text.replace(/^(?:<@(?:U0C6PAA9PT5|U0C9ZFB8FQA)> )+/, '');
  return [text, bare, withActorMentions(bare, ['dot']), withActorMentions(bare, ['scout']),
    withActorMentions(bare, ['dot','scout'])];
}
