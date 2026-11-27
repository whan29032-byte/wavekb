'use strict';

function isValidRouteRoles(routeRoles) {
  return Boolean(
    routeRoles &&
    typeof routeRoles.guildId === 'string' && routeRoles.guildId &&
    typeof routeRoles.esperRoleId === 'string' && routeRoles.esperRoleId &&
    typeof routeRoles.magicianRoleId === 'string' && routeRoles.magicianRoleId &&
    routeRoles.esperRoleId !== routeRoles.magicianRoleId
  );
}

async function syncRouteRole({ member, guildId, path, routeRoles }) {
  if (!routeRoles || guildId !== routeRoles.guildId) {
    return { status: 'skipped' };
  }
  if (!isValidRouteRoles(routeRoles) || !['esper', 'magician'].includes(path)) {
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

  const selectedRoleId = path === 'esper'
    ? routeRoles.esperRoleId
    : routeRoles.magicianRoleId;
  const oppositeRoleId = path === 'esper'
    ? routeRoles.magicianRoleId
    : routeRoles.esperRoleId;
  let added = false;
  let removed = false;

  if (!member.roles.cache.has(selectedRoleId)) {
    try {
      await member.roles.add(selectedRoleId);
      added = true;
    } catch {
      return {
        status: 'failed',
        reason: 'add_failed',
        added: false,
        removed: false
      };
    }
  }

  if (member.roles.cache.has(oppositeRoleId)) {
    try {
      await member.roles.remove(oppositeRoleId);
      removed = true;
    } catch {
      return {
        status: 'failed',
        reason: 'remove_failed',
        added,
        removed: false
      };
    }
  }

  return {
    status: added || removed ? 'synced' : 'already_synced',
    added,
    removed
  };
}

module.exports = { syncRouteRole };
