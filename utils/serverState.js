const _serverStartTime = new Date();
const _serverLogs = []; // In-memory ring buffer, max 200 lines

// Intercept console to capture server logs
const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);
const _origWarn = console.warn.bind(console);

function _captureLog(level, args) {
  const line = { 
    time: new Date().toISOString(), 
    level, 
    text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') 
  };
  _serverLogs.push(line);
  if (_serverLogs.length > 200) _serverLogs.shift();
}

console.log = (...a) => { _captureLog('info', a); _origLog(...a); };
console.error = (...a) => { _captureLog('error', a); _origError(...a); };
console.warn = (...a) => { _captureLog('warn', a); _origWarn(...a); };

module.exports = {
  _serverStartTime,
  _serverLogs
};
