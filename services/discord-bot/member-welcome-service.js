'use strict';

const { buildMemberWelcome } = require('./member-onboarding');

const WELCOME_CATCH_UP_LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const WELCOME_CATCH_UP_LIMIT = 10;
const inFlightWelcomeDeliveries = new Map();

async function deliverMemberWelcome({ member, channelId, database, now = Date.now() }) {
  if (member.user?.bot) return { status: 'ignored-bot' };
  if (!Number.isSafeInteger(member.joinedTimestamp)) {
    throw new Error('新成员缺少有效的加入时间');
  }

  const guildId = member.guild.id;
  if (database.hasMemberWelcome(guildId, member.id, member.joinedTimestamp)) {
    return { status: 'already-sent' };
  }

  const deliveryKey = `${guildId}:${member.id}:${member.joinedTimestamp}`;
  const inFlight = inFlightWelcomeDeliveries.get(deliveryKey);
  if (inFlight) {
    await inFlight;
    return { status: 'already-sent' };
  }

  const delivery = Promise.resolve().then(async () => {
    const channel = await member.guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== 'function') {
      throw new Error('欢迎频道不可发送消息');
    }

    const message = await channel.send(buildMemberWelcome(member));
    database.recordMemberWelcome(
      guildId,
      member.id,
      member.joinedTimestamp,
      message.id,
      now
    );
    return { status: 'sent', messageId: message.id };
  });
  inFlightWelcomeDeliveries.set(deliveryKey, delivery);

  try {
    return await delivery;
  } finally {
    if (inFlightWelcomeDeliveries.get(deliveryKey) === delivery) {
      inFlightWelcomeDeliveries.delete(deliveryKey);
    }
  }
}

async function catchUpRecentMemberWelcomes({
  guild,
  channelId,
  database,
  now = Date.now(),
  logger = console,
  lookbackMs = WELCOME_CATCH_UP_LOOKBACK_MS,
  limit = WELCOME_CATCH_UP_LIMIT
}) {
  const fetched = await guild.members.fetch();
  const cutoff = now - lookbackMs;
  const candidates = [...fetched.values()]
    .filter(member => (
      !member.user?.bot
      && Number.isSafeInteger(member.joinedTimestamp)
      && member.joinedTimestamp >= cutoff
      && member.joinedTimestamp <= now
      && !database.hasMemberWelcome(guild.id, member.id, member.joinedTimestamp)
    ))
    .sort((left, right) => left.joinedTimestamp - right.joinedTimestamp)
    .slice(0, limit);

  let sent = 0;
  let failed = 0;
  for (const member of candidates) {
    try {
      const result = await deliverMemberWelcome({ member, channelId, database, now });
      if (result.status === 'sent') sent += 1;
    } catch (error) {
      failed += 1;
      logger.warn('新人欢迎补发失败', error);
    }
  }
  return { sent, failed };
}

module.exports = {
  deliverMemberWelcome,
  catchUpRecentMemberWelcomes,
  WELCOME_CATCH_UP_LOOKBACK_MS,
  WELCOME_CATCH_UP_LIMIT
};
