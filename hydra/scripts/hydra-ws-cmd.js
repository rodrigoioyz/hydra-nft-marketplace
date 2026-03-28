#!/usr/bin/env node
// ============================================================
// Hydra WebSocket Command Sender
// Usage: node hydra-ws-cmd.js <command> [wait_event] [timeout_s]
// Examples:
//   node hydra-ws-cmd.js Init HeadIsInitializing 180
//   node hydra-ws-cmd.js Close HeadIsClosed 180
//   node hydra-ws-cmd.js Fanout HeadIsFinalized 180
//   node hydra-ws-cmd.js Abort HeadAborted 180
//   node hydra-ws-cmd.js status   (just print Greetings)
// ============================================================
const WebSocket = require('ws');

const API_HOST = process.env.HYDRA_API || '127.0.0.1:4001';
const command = process.argv[2];
const waitEvent = process.argv[3];
const timeoutSec = parseInt(process.argv[4] || '120');

if (!command) {
    console.error('Usage: node hydra-ws-cmd.js <command> [wait_event] [timeout_s]');
    process.exit(1);
}

const ws = new WebSocket(`ws://${API_HOST}`);
let done = false;

function finish(code) {
    if (!done) { done = true; ws.close(); process.exit(code); }
}

ws.on('open', () => {
    if (command === 'status') return; // just wait for Greetings
    // Send after small delay to ensure connection is ready
    setTimeout(() => {
        ws.send(JSON.stringify({ tag: command }));
        console.log(`CMD_SENT:${command}`);
    }, 200);
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        if (msg.tag === 'Greetings') {
            console.log(`STATE:${msg.headStatus}`);
            console.log(`HEAD_ID:${msg.hydraHeadId || 'none'}`);
            console.log(`VERSION:${msg.hydraNodeVersion}`);
            if (command === 'status') finish(0);
            return;
        }
        console.log(`EVENT:${msg.tag}`);
        if (msg.tag === waitEvent) {
            // Print useful info
            if (msg.contestationDeadline) console.log(`DEADLINE:${msg.contestationDeadline}`);
            if (msg.headId) console.log(`HEAD_ID:${msg.headId}`);
            finish(0);
        }
        if (['CommandFailed', 'PostTxOnChainFailed'].includes(msg.tag)) {
            console.error(`ERROR:${JSON.stringify(msg).substring(0, 500)}`);
            finish(1);
        }
    } catch (e) {
        console.error(`PARSE_ERROR:${e.message}`);
    }
});

ws.on('error', (err) => {
    console.error(`WS_ERROR:${err.message}`);
    finish(1);
});

ws.on('close', () => {
    if (!done) finish(0);
});

setTimeout(() => {
    console.error(`TIMEOUT:${timeoutSec}s`);
    finish(waitEvent ? 1 : 0);
}, timeoutSec * 1000);
