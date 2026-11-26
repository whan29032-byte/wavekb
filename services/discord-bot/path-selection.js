'use strict';

const PATH_NAMES = {
  esper: '科学侧能力者',
  magician: '魔法侧魔法师'
};

async function handlePathSelection(
  interaction,
  newPath,
  {
    database,
    syncRouteRole = async () => ({ status: 'skipped' }),
    syncGrowthRole = async () => ({ status: 'skipped' })
  },
  { successEphemeral = false } = {}
) {
  const result = database.changePath(
    interaction.guildId,
    interaction.user.id,
    newPath
  );

  if (result.reason === 'same') {
    const syncResult = await syncProfileRoles({
      interaction,
      user: result.user,
      syncRouteRole,
      syncGrowthRole
    });
    if (syncResult.status === 'failed') {
      await replyRoleSyncFailure(interaction);
      return;
    }
    await respondToSelection(interaction, {
      content: `你已经是${PATH_NAMES[newPath]}了。`,
      ephemeral: true
    });
    return;
  }

  if (result.reason === 'cooldown') {
    const days = Math.ceil(result.remainingMs / 86_400_000);
    await respondToSelection(interaction, {
      content: `冷却中，还需 **${days}** 天才能切换。`,
      ephemeral: true
    });
    return;
  }

  const syncResult = await syncProfileRoles({
    interaction,
    user: result.user,
    syncRouteRole,
    syncGrowthRole
  });
  if (syncResult.status === 'failed') {
    await replyRoleSyncFailure(interaction);
    return;
  }

  const content = `已切换为 **${PATH_NAMES[newPath]}** 路线。`;
  await respondToSelection(
    interaction,
    successEphemeral ? { content, ephemeral: true } : content
  );
}

async function replyRoleSyncFailure(interaction) {
  await respondToSelection(interaction, {
    content: '档案已保存，但身份或成长角色同步失败，请稍后再次选择当前路线重试。',
    ephemeral: true
  });
}

async function respondToSelection(interaction, response) {
  if (!interaction.deferred) return interaction.reply(response);

  const payload = typeof response === 'string'
    ? { content: response }
    : { ...response };
  delete payload.ephemeral;
  return interaction.editReply(payload);
}

async function syncProfileRoles({ interaction, user, syncRouteRole, syncGrowthRole }) {
  try {
    const identityResult = await syncRouteRole({
      member: interaction.member,
      guildId: interaction.guildId,
      path: user.path
    });
    if (identityResult.status === 'failed') return identityResult;

    return await syncGrowthRole({
      member: interaction.member,
      guildId: interaction.guildId,
      path: user.path,
      level: user.level
    });
  } catch {
    return { status: 'failed' };
  }
}

module.exports = { handlePathSelection };
