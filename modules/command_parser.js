function parseCommandText(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const parts = text.trim().split(/\s+/);
    const raw = parts.shift().toLowerCase();
    return {
        command: raw.startsWith('/') ? raw.slice(1) : raw,
        args: parts
    };
}

function getMessageText(message) {
    return message?.conversation ||
        message?.extendedTextMessage?.text ||
        message?.imageMessage?.caption ||
        message?.videoMessage?.caption ||
        '';
}

module.exports = { parseCommandText, getMessageText };
