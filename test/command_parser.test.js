const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommandText, getMessageText } = require('../modules/command_parser');

test('parses commands with and without a leading slash', () => {
    assert.deepEqual(parseCommandText('/remind 5m hello world'), {
        command: 'remind',
        args: ['5m', 'hello', 'world']
    });
    assert.deepEqual(parseCommandText('help'), { command: 'help', args: [] });
});

test('extracts text from supported WhatsApp message shapes', () => {
    assert.equal(getMessageText({ imageMessage: { caption: '/stiker' } }), '/stiker');
    assert.equal(getMessageText({ extendedTextMessage: { text: 'hello' } }), 'hello');
    assert.equal(getMessageText({}), '');
});
