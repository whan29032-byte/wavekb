'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ButtonStyle, ComponentType } = require('discord.js');

const {
  buildMemberWelcome,
  parsePathButton
} = require('../member-onboarding');

test('member welcome mentions only the new member and presents the Index theme', () => {
  const payload = buildMemberWelcome({
    id: 'member-1',
    toString: () => '<@member-1>'
  });

  assert.equal(payload.content, '<@member-1>，欢迎加入「悠の学园都市」！');
  assert.deepEqual(payload.allowedMentions, {
    parse: [],
    users: ['member-1']
  });
  assert.equal(payload.embeds.length, 1);
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, '📜 新人入学登记');
  assert.match(embed.description, /科学侧与魔法侧并存/);
  assert.match(embed.description, /选择阵营/);
  assert.match(embed.footer.text, /悠の学园都市/);
});

test('member welcome provides one science button and one magic button', () => {
  const payload = buildMemberWelcome({
    id: 'member-1',
    toString: () => '<@member-1>'
  });

  assert.equal(payload.components.length, 1);
  const row = payload.components[0].toJSON();
  assert.equal(row.type, ComponentType.ActionRow);
  assert.deepEqual(row.components, [
    {
      type: ComponentType.Button,
      custom_id: 'onboarding:path:esper',
      label: '加入科学侧',
      style: ButtonStyle.Primary,
      emoji: { id: undefined, name: '⚡', animated: false }
    },
    {
      type: ComponentType.Button,
      custom_id: 'onboarding:path:magician',
      label: '加入魔法侧',
      style: ButtonStyle.Secondary,
      emoji: { id: undefined, name: '✨', animated: false }
    }
  ]);
});

test('path button parser accepts only the two onboarding button IDs', () => {
  assert.equal(parsePathButton('onboarding:path:esper'), 'esper');
  assert.equal(parsePathButton('onboarding:path:magician'), 'magician');
  assert.equal(parsePathButton('onboarding:path:unknown'), null);
  assert.equal(parsePathButton('other:path:esper'), null);
  assert.equal(parsePathButton(null), null);
});
