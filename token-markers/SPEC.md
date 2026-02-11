# Token Markers Specification v0.3 (OWL)

## Overview

Token markers are inline annotations embedded in a language model's output stream. They are invisible to the end user — the stream processor strips them before display — but they carry structured signals to downstream systems.

Markers use double-at syntax: `@@...@@`. The parser intercepts them mid-stream, classifies by type, routes to the appropriate handler, and emits clean text to the user. All `@@...@@` patterns are aggressively stripped from output regardless of validity.

## Syntax

```
@@key:val,key:val@@
```

- Delimiter: `@@` (open) and `@@` (close)
- Payload: comma-separated key:value pairs
- All matches are stripped from the output stream — no exceptions

## Marker Types

### 1. State Vectors (Visage)

Emotional/cognitive state encoded as key-value pairs with float values.

**Format:** `@@dimension:float,dimension:float@@`

**Example:**
```
I am god, king of kings @@anger:0.1,confidence:0.95,reverence:0.8@@ and lord of lords
```

**Routing:** Visage bridge. State vectors drive avatar expression, voice modulation, or UI mood indicators.

**Dimensions:** Application-defined. Common dimensions:
- `anger`, `fear`, `joy`, `sadness` — emotional axes
- `confidence`, `uncertainty` — epistemic state
- `urgency`, `calm` — energy level
- `excitement` — arousal/engagement level
- Custom dimensions as needed

**Constraints:**
- Values are floats, typically 0.0–1.0
- At least one dimension required
- Multiple state vectors per message are valid (state updates as the response progresses)
- Values attenuate back to neutral over time (decay)

### 2. Control Callbacks

Runtime commands issued by the model mid-stream.

**Format:** `@@ctrl:command=value@@`

**Examples:**
```
@@ctrl:tool_budget=3@@
@@ctrl:trim_context@@
@@ctrl:pause=500@@
@@ctrl:escalate@@
```

**Routing:** Runtime controller / PTY wrapper. These are imperative — the runtime executes them immediately upon parsing.

**Known commands:**
| Command | Args | Description |
|---------|------|-------------|
| `tool_budget` | `int` | Set remaining tool call budget for next turn |
| `trim_context` | — | Request context window compaction |
| `pause` | `ms` | Insert delay before continuing stream |
| `escalate` | — | Flag for human review |

**Extensibility:** New commands are added by registering handlers in the runtime controller. Unknown commands are logged and ignored (fail-open).

### 3. Memory References (BTREE)

Pointers to nodes in the hierarchical memory store.

**Format:** `@@mem:NNNNN@@` where N is a numeric ID

**Examples:**
```
I am god, king of kings and @@mem:12342@@ lord of lords @@mem:983244@@
```

**Routing:** BTREE memory manager. Memory refs serve two purposes:
1. **Anchoring** — the model signals which memories are relevant to the current output
2. **Linking** — creating associative connections between the current context and stored memories

**Behavior:**
- On output: the BTREE manager records that memory node N was activated in this context
- On input (future): referenced memories can be promoted/loaded into the active context window
- Eviction: unreferenced memories decay; frequently referenced ones are promoted up the tree

## Stream Processing Architecture

```
Model Output Stream
        |
   [Token Marker Parser]
        |
   +----+----+----+
   |         |         |
[Visage]  [Runtime]  [BTREE]
   |         |         |
State     Execute    Memory
Update    Command    Link/Activate
        |
   [Clean Text]
        |
   User Display
```

### Parser Behavior

1. Regex match all `@@...@@` patterns in the output stream
2. For each match, classify:
   - Contains `:` with float values → **State Vector**
   - Starts with `ctrl:` → **Control Callback**
   - Starts with `mem:` → **Memory Ref**
3. Route to appropriate handler
4. Strip ALL `@@...@@` matches from output — valid or not
5. Forward clean text to user

### Stripping Rules

- **Aggressive strip**: every `@@...@@` pattern is removed, no exceptions
- Regex: `/@@[^@]+@@/g`
- Invalid/malformed markers are stripped and logged as warnings
- The model emits raw markers with no checksum — the wrapper handles validation
- Stripping happens before output enters context or reaches the user

### Edge Cases

- Nested `@@`: not supported. Outer match wins.
- Malformed markers: stripped and logged (fail-closed for display, fail-open for parsing).
- Empty markers: `@@@@` ignored and stripped.
- Context poisoning: all markers are stripped before any output feeds back to context, preventing self-injection.

## Integration Points

### Visage Bridge
- Receives state vectors as JSON: `{"anger": 0.1, "confidence": 0.95}`
- Updates avatar/expression system in real-time
- Smooths transitions between state updates (interpolation)
- Values attenuate toward neutral with configurable decay rate

### Runtime Controller
- Receives parsed command + args
- Executes registered handlers
- Returns success/failure (logged, does not affect stream)

### BTREE Memory Manager
- Receives memory node IDs
- Records activation timestamps and context associations
- Supports promote/demote/evict operations based on reference frequency

## Design Principles

1. **Invisible to users** — markers never appear in displayed text
2. **Aggressive stripping** — all `@@...@@` patterns removed, valid or not
3. **Stateless parsing** — the parser carries no state between markers; each is self-contained
4. **Extensible** — new marker types and commands added by registering handlers
5. **Low overhead** — parsing adds negligible latency to the token stream
6. **No context poisoning** — markers stripped before output re-enters model context
