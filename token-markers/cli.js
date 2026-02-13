#!/usr/bin/env node
/**
 * token-markers/cli.js
 *
 * CLI for the token marker parser.
 *
 * Usage:
 *   echo "text with @@markers@@" | node cli.js parse     # Extract and classify markers (JSON)
 *   echo "text with @@markers@@" | node cli.js strip      # Output clean text
 *   echo "text with @@markers@@" | node cli.js route      # Parse, print markers to stderr, clean text to stdout
 *   echo "text with @@markers@@" | node cli.js stream     # Streaming mode — process chunks as they arrive
 *
 *   node cli.js parse "inline text with @@markers@@"      # Inline text argument
 *   node cli.js classify "anger:0.5,joy:0.8"              # Classify a single payload
 */

'use strict';

const { classify, parse, strip, createRouter, createStreamProcessor } = require('./parser');

const args = process.argv.slice(2);
const command = args[0];
const inlineText = args.slice(1).join(' ');

function usage() {
  console.error(`Usage: agenttools-markers <command> [text]

Commands:
  parse     Extract and classify all markers (JSON output)
  strip     Remove all markers, output clean text
  route     Parse markers to stderr (JSON), clean text to stdout
  stream    Streaming mode — reads stdin chunks, routes markers
  classify  Classify a single marker payload (without @@ delimiters)

Text can be provided as an argument or piped via stdin.`);
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY && !inlineText) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  if (!command) {
    usage();
  }

  switch (command) {
    case 'parse': {
      const text = inlineText || await readStdin();
      if (!text) { usage(); }
      const markers = parse(text);
      console.log(JSON.stringify(markers, null, 2));
      break;
    }

    case 'strip': {
      const text = inlineText || await readStdin();
      if (!text) { usage(); }
      process.stdout.write(strip(text));
      break;
    }

    case 'route': {
      const text = inlineText || await readStdin();
      if (!text) { usage(); }
      const route = createRouter({
        state_vector: (m) => console.error(JSON.stringify(m)),
        ctrl: (m) => console.error(JSON.stringify(m)),
        mem: (m) => console.error(JSON.stringify(m)),
        unknown: (m) => console.error(JSON.stringify(m)),
      });
      const clean = route(text);
      process.stdout.write(clean);
      break;
    }

    case 'stream': {
      const proc = createStreamProcessor(
        {
          state_vector: (m) => console.error(JSON.stringify(m)),
          ctrl: (m) => console.error(JSON.stringify(m)),
          mem: (m) => console.error(JSON.stringify(m)),
          unknown: (m) => console.error(JSON.stringify(m)),
        },
        (text) => process.stdout.write(text)
      );
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => proc.push(chunk));
      process.stdin.on('end', () => {
        proc.flush();
      });
      break;
    }

    case 'classify': {
      const payload = inlineText || await readStdin();
      if (!payload) { usage(); }
      const result = classify(payload.trim());
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
