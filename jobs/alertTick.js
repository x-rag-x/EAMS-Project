const mongoose = require('mongoose');
const { evaluateLiveAlerts } = require('../utils/alertRules');

let alertInterval = null;
let _initialAlertTimeout = null;

/**
 * Start periodic 60-second alert evaluation tick
 */
function startAlertTick() {
  if (alertInterval) return;

  const scheduleInitial = () => {
    if (_initialAlertTimeout) clearTimeout(_initialAlertTimeout);
    _initialAlertTimeout = setTimeout(() => {
      if (!mongoose.connection || mongoose.connection.readyState !== 1) return;
      evaluateLiveAlerts().catch(err => {
        console.warn('[Alert Tick Initial Run Error]:', err.message);
      });
    }, 2000);
  };

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    scheduleInitial();
  } else if (mongoose.connection) {
    mongoose.connection.once('connected', scheduleInitial);
  }

  // Schedule every 60 seconds
  alertInterval = setInterval(() => {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) return;
    evaluateLiveAlerts().catch(err => {
      console.warn('[Alert Tick Error]:', err.message);
    });
  }, 60 * 1000);

  if (alertInterval.unref) alertInterval.unref();
}

function stopAlertTick() {
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
  if (_initialAlertTimeout) {
    clearTimeout(_initialAlertTimeout);
    _initialAlertTimeout = null;
  }
}

module.exports = {
  startAlertTick,
  stopAlertTick
};
