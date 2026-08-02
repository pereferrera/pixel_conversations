# Characters

This folder contains the simulation's fixed roster of ten characters. Profiles are
data only: they describe who a character is and how they tend to converse, but do
not contain sprites, placement, mood, relationships, memories, or any other
runtime state.

## Profile shape

Every JSON profile has the following groups:

- `identity`: stable identifying information.
- `portrait`: non-rendering visual notes that can later guide sprite work.
- `personality`: a concise trait summary plus normalized behavioural tendencies
  (`0` = low, `1` = high).
- `interests`: recurring conversation material, with `expertise` identifying
  areas the character can speak about with confidence.
- `conversation`: voice and interaction preferences for prompt construction.
- `storyHooks`: tensions, goals, and invitations other characters can respond to.

`id` values are stable, kebab-case identifiers. New engine state should refer to
them rather than names. The roster intentionally does not prescribe friendships
or rivalries; those are emergent runtime relationships.
