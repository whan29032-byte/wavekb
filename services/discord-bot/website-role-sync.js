'use strict';

const { PermissionsBitField } = require('discord.js');

const DANGEROUS_PERMISSIONS = new PermissionsBitField([
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ManageThreads,
  PermissionsBitField.Flags.ManageEvents,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ManageNicknames,
  PermissionsBitField.Flags.MuteMembers,
  PermissionsBitField.Flags.DeafenMembers,
  PermissionsBitField.Flags.MoveMembers
]);

function hierarchyAllows(role, botHighestRole) {
  if (typeof role.comparePositionTo === 'function') {
    return role.comparePositionTo(botHighestRole) < 0;
  }
  return Number.isFinite(role.position) &&
    Number.isFinite(botHighestRole?.position) &&
    role.position < botHighestRole.position;
}

function validateActionRoles(member, roleIds) {
  const guild = member.guild;
  const botHighestRole = guild?.members?.me?.roles?.highest;
  if (!guild?.roles?.cache || typeof guild.roles.cache.get !== 'function') {
    return 'member_unavailable';
  }
  if (!botHighestRole) return 'bot_member_unavailable';

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) return 'missing_role';
    if (role.id === guild.id || role === guild.roles.everyone || role.name === '@everyone') {
      return 'everyone_role';
    }
    if (role.guild !== guild) return 'cross_guild_role';
    if (role.managed) return 'managed_role';
    if (!role.permissions) return 'dangerous_role';
    try {
      if (new PermissionsBitField(role.permissions).any(DANGEROUS_PERMISSIONS, false)) {
        return 'dangerous_role';
      }
    } catch {
      return 'dangerous_role';
    }
    if (!hierarchyAllows(role, botHighestRole)) return 'role_hierarchy';
  }
  return null;
}

async function syncWebsiteRoles({ member, guildId, profile, integration }) {
  if (!integration || guildId !== integration.guildId) return { status: 'skipped' };
  if (
    !member?.guild ||
    !member?.roles?.cache ||
    typeof member.roles.cache.has !== 'function' ||
    typeof member.roles.add !== 'function' ||
    typeof member.roles.remove !== 'function'
  ) {
    return { status: 'failed', reason: 'member_unavailable' };
  }

  const isUnlinked = profile === null;
  if (!isUnlinked && (
    !profile ||
    !Object.prototype.hasOwnProperty.call(profile, 'displayTitle')
  )) {
    return { status: 'failed', reason: 'invalid_profile' };
  }

  const titleRoleMap = integration.titleRoleMap || {};
  const targetTitleRoleId = !isUnlinked && profile.displayTitle
    ? titleRoleMap[profile.displayTitle] || null
    : null;
  const targetRoleIds = isUnlinked
    ? []
    : [...new Set([integration.linkedRoleId, targetTitleRoleId].filter(Boolean))];
  const staleCandidates = isUnlinked
    ? [integration.linkedRoleId, ...Object.values(titleRoleMap)]
    : Object.values(titleRoleMap).filter(roleId => roleId !== targetTitleRoleId);
  const staleRoleIds = [...new Set(staleCandidates.filter(
    roleId => roleId && member.roles.cache.has(roleId)
  ))];
  const configuredRoleIds = [...new Set([
    integration.linkedRoleId,
    ...Object.values(titleRoleMap)
  ].filter(Boolean))];
  const unsafeReason = validateActionRoles(member, configuredRoleIds);
  if (unsafeReason) return { status: 'failed', reason: unsafeReason };

  const addedRoleIds = [];
  const removedRoleIds = [];
  for (const roleId of targetRoleIds) {
    if (member.roles.cache.has(roleId)) continue;
    try {
      await member.roles.add(roleId);
      addedRoleIds.push(roleId);
    } catch {
      return {
        status: 'failed',
        reason: 'add_failed',
        addedRoleIds,
        removedRoleIds
      };
    }
  }

  for (const roleId of staleRoleIds) {
    try {
      await member.roles.remove(roleId);
      removedRoleIds.push(roleId);
    } catch {
      return {
        status: 'failed',
        reason: 'remove_failed',
        addedRoleIds,
        removedRoleIds
      };
    }
  }

  return {
    status: addedRoleIds.length || removedRoleIds.length ? 'synced' : 'already_synced',
    addedRoleIds,
    removedRoleIds
  };
}

module.exports = { syncWebsiteRoles };
