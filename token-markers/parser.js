#!/usr/bin/env node
/**
 * token-markers/parser.js
 *
 * Core parser for @@...@@ token markers.
 * Extracts, classifies, strips, and routes markers from LLM output streams.
 *
 * Marker types:
 *   - State Vector: @@dimension:float,dimension:float@@
 *   - Control:      @@ctrl:command=value@@ or @@ctrl:command@@
 *   - Memory Ref:   @@mem:id@@ (numeric or hex)
 *
 * All @@...@@ patterns are aggressively stripped from output regardless of validity.
 */

'use strict';

// --- Constants ---

const MARKER_REGEX = /@@([^@]+)@@/g;
const CTRL_PREFIX = 'ctrl:';
const MEM_PREFIX = 'mem:';
const MEM_ID_REGEX = /^[0-9a-fA-F]+$/;

// --- Types ---

/**
 * @typedef {'state_vector' | 'ctrl' | 'mem' | 'unknown'} MarkerType
 *
 * @typedef {Object} StateVectorMarker
 * @property {'state_vector'} type
 * @property {Record<string, number>} dimensions
 * @property {string} raw
 *
 * @typedef {Object} CtrlMarker
 * @property {'ctrl'} type
 * @property {string} command
 * @property {string|null} value
 * @property {string} raw
 *
 * @typedef {Object} MemMarker
 * @property {'mem'} type
 * @property {string} id
 * @property {string} raw
 *
 * @typedef {Object} UnknownMarker
 * @property {'unknown'} type
 * @property {string} raw
 *
 * @typedef {StateVectorMarker | CtrlMarker | MemMarker | UnknownMarker} Marker
 */

// --- Classification ---

/**
 * Classify a marker payload string into a typed marker object.
 * @param {string} payload - The content between @@ delimiters
 * @returns {Marker}
 */
function classify(payload) {
  const raw = `@@${payload}@@`;

  // Control callback: starts with ctrl:
  if (payload.startsWith(CTRL_PREFIX)) {
    const rest = payload.slice(CTRL_PREFIX.length);
    const eqIdx = rest.indexOf('=');
    if (eqIdx === -1) {
      return { type: 'ctrl', command: rest, value: null, raw };
    }
    return {
      type: 'ctrl',
      command: rest.slice(0, eqIdx),
      value: rest.slice(eqIdx + 1),
      raw,
    };
  }

  // Memory reference: starts with mem:
  if (payload.startsWith(MEM_PREFIX)) {
    const id = payload.slice(MEM_PREFIX.length);
    if (id.length > 0 && MEM_ID_REGEX.test(id)) {
      return { type: 'mem', id, raw };
    }
    // Malformed mem ref — still parsed, id kept as-is
    return { type: 'mem', id, raw };
  }

  // State vector: key:float pairs separated by commas
  const pairs = payload.split(',');
  const dimensions = {};
  let isStateVector = true;

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) {
      isStateVector = false;
      break;
    }
    const key = pair.slice(0, colonIdx).trim();
    const valStr = pair.slice(colonIdx + 1).trim();
    const val = parseFloat(valStr);

    if (key.length === 0 || isNaN(val)) {
      isStateVector = false;
      break;
    }
    dimensions[key] = val;
  }

  if (isStateVector && Object.keys(dimensions).length > 0) {
    return { type: 'state_vector', dimensions, raw };
  }

  // Unknown marker type
  return { type: 'unknown', raw };
}

// --- Parsing ---

/**
 * Extract and classify all markers from a text string.
 * @param {string} text - The raw LLM output
 * @returns {Marker[]} Array of parsed markers in order of appearance
 */
function parse(text) {
  const markers = [];
  let match;
  // Reset regex state
  MARKER_REGEX.lastIndex = 0;
  while ((match = MARKER_REGEX.exec(text)) !== null) {
    const payload = match[1];
    if (payload.length > 0) {
      markers.push(classify(payload));
    }
  }
  return markers;
}

// --- Stripping ---

/**
 * Remove all @@...@@ markers from text, returning clean output.
 * Aggressively strips ALL matches regardless of validity.
 * @param {string} text - The raw LLM output
 * @returns {string} Clean text with markers removed
 */
function strip(text) {
  return text.replace(/@@[^@]*@@/g, '');
}

// --- Routing ---

/**
 * Create a router that dispatches parsed markers to registered handlers.
 *
 * @param {Object} handlers
 * @param {function(StateVectorMarker): void} [handlers.state_vector]
 * @param {function(CtrlMarker): void} [handlers.ctrl]
 * @param {function(MemMarker): void} [handlers.mem]
 * @param {function(UnknownMarker): void} [handlers.unknown]
 * @returns {function(string): string} A function that parses, routes, and returns clean text
 */
function createRouter(handlers = {}) {
  return function route(text) {
    const markers = parse(text);

    for (const marker of markers) {
      const handler = handlers[marker.type];
      if (handler) {
        try {
          handler(marker);
        } catch (err) {
          // Handlers should not throw, but if they do, log and continue
          console.warn(`[token-markers] handler error for ${marker.type}:`, err.message);
        }
      }
    }

    return strip(text);
  };
}

// --- Stream processor ---

/**
 * Process a stream of text chunks, handling markers that may span chunk boundaries.
 * Returns an object with push() and flush() methods.
 *
 * @param {Object} handlers - Same as createRouter handlers
 * @param {function(string): void} onText - Callback for clean text output
 * @returns {{ push: function(string): void, flush: function(): void }}
 */
function createStreamProcessor(handlers = {}, onText = () => {}) {
  const router = createRouter(handlers);
  let buffer = '';

  function hasCompleteMarker(text) {
    // Check if text contains at least one @@...@@ pattern
    return /@@[^@]+@@/.test(text);
  }

  function trailingIncomplete(text) {
    // Find if there's an unpaired @@ at the end (potential marker start)
    // Strip all complete markers first, then check for remaining @@
    const stripped = text.replace(/@@[^@]*@@/g, '');
    const idx = stripped.lastIndexOf('@@');
    if (idx === -1) return -1;
    // Map back to original position: find the Nth @@ in original that isn't part of a complete marker
    // Simpler: find last @@ in original that doesn't have a closing @@
    let pos = text.length;
    while (pos > 0) {
      pos = text.lastIndexOf('@@', pos - 1);
      if (pos === -1) return -1;
      // Check if there's a closing @@ after this position
      const close = text.indexOf('@@', pos + 2);
      if (close === -1) return pos; // No closing — this is incomplete
      // There is a closing @@, but is this opening part of a complete marker?
      // Check if text from pos matches a complete marker
      const sub = text.slice(pos);
      if (/^@@[^@]+@@/.test(sub)) {
        // This is a complete marker's opening — skip it
        continue;
      }
      return pos;
    }
    return -1;
  }

  return {
    push(chunk) {
      buffer += chunk;

      const incompletePos = trailingIncomplete(buffer);

      if (incompletePos === -1) {
        // No incomplete markers — safe to process everything
        const clean = router(buffer);
        if (clean.length > 0) onText(clean);
        buffer = '';
      } else {
        // Process everything before the incomplete marker
        const safe = buffer.slice(0, incompletePos);
        if (safe.length > 0) {
          const clean = router(safe);
          if (clean.length > 0) onText(clean);
        }
        buffer = buffer.slice(incompletePos);
      }
    },

    flush() {
      if (buffer.length > 0) {
        const clean = router(buffer);
        if (clean.length > 0) onText(clean);
        buffer = '';
      }
    },
  };
}

module.exports = {
  classify,
  parse,
  strip,
  createRouter,
  createStreamProcessor,
  MARKER_REGEX,
};
