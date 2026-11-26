# Discord Bundled Font Design

## Intent

Discord profile, level-up, and leaderboard images must render Chinese and Latin text on the production Linux host without relying on host-installed fonts.

## Selected approach

Bundle the official Noto Sans CJK SC Regular OpenType font and its SIL Open Font License with the bot. Register it once through `@napi-rs/canvas` under a private family alias, then make every Discord canvas renderer use that alias.

Alternatives rejected:

- Installing fonts on the host would leave rendering dependent on mutable server configuration.
- Keeping system fallbacks would preserve the current failure mode on minimal Linux images.
- Subsetting the font would risk dropping characters from member names, abilities, chants, or future Chinese copy.

## Constraints

- Preserve the current card and leaderboard layout, colors, copy, and dimensions.
- Include the upstream OFL license beside the font.
- Fail startup clearly if the bundled font is missing or cannot be registered.
- Test actual rendered pixels, not only source strings or PNG dimensions.
- Keep both profile cards and leaderboards on the same registered font family.

## Success criteria

- A clean runtime can register the bundled font and render both Chinese and ASCII glyph pixels.
- The production package contains the font and license.
- Existing bot tests remain green.
- A production-generated image visibly contains its title, member name, level, profile fields, and experience labels.
