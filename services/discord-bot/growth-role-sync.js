'use strict';

const TRACK_SIZE = 6;

function isValidGrowthRoles(growthRoles) {
  if (!growthRoles || typeof growthRoles.guildId !== 'string' || !growthRoles.guildId) return false;
  const tracks = [growthRoles.esperRoleIds, growthRoles.magicianRoleIds];
  if (tracks.some(roleIds => !Array.isArray(roleIds) || roleIds.length !== TRACK_SIZE)) return false;
  const roleIds = tracks.flat();
  return roleIds.every(roleId => typeof roleId === 'string' && roleId) &&
    new Set(roleIds).size === roleIds.length;
}

async function syncGrowthRole({ member, guildId, path, level, growthRoles }) {
  if (!growthRoles || guildId !== growthRoles.guildId) return { status: 'skipped' };
  if (
    !isValidGrowthRoles(growthRoles) ||
    !['esper', 'magician'].includes(path) ||
    !Number.isInteger(level) ||
    level < 1
  ) {
    return { status: 'failed', reason: 'invalid_config' };
  }
  if (
    !member?.roles?.cache ||
    typeof member.roles.cache.has !== 'function' ||
    typeof member.roles.add !== 'function' ||
    typeof member.roles.remove !== 'function'
  ) {
    return { status: 'failed', reason: 'member_unavailable' };
  }

  const stage = Math.min(level - 1, TRACK_SIZE - 1);
  const selectedTrack = path === 'esper'
    ? growthRoles.esperRoleIds
    : growthRoles.magicianRoleIds;
  const targetRoleId = selectedTrack[stage];
  let added = false;
  const removedRoleIds = [];

  if (!member.roles.cache.has(targetRoleId)) {
    try {
      await member.roles.add(targetRoleId);
      added = true;
    } catch {
      return {
        status: 'failed',
        reason: 'add_failed',
        targetRoleId,
        added: false,
        removedRoleIds
      };
    }
  }

  const staleRoleIds = [...growthRoles.esperRoleIds, ...growthRoles.magicianRoleIds]
    .filter(roleId => roleId !== targetRoleId && member.roles.cache.has(roleId));
  for (const roleId of staleRoleIds) {
    try {
      await member.roles.remove(roleId);
      removedRoleIds.push(roleId);
    } catch {
      return {
        status: 'failed',
        reason: 'remove_failed',
        targetRoleId,
        added,
        removedRoleIds
      };
    }
  }

  return {
    status: added || removedRoleIds.length > 0 ? 'synced' : 'already_synced',
    targetRoleId,
    added,
    removedRoleIds
  };
}

module.exports = { syncGrowthRole };
