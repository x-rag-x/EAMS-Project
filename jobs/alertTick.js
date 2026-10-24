const { evaluateLiveAlerts } = require('../utils/alertRules');

let alertInterval = null;

/**
 * Start periodic 60-second alert evaluation tick
 */
function startAlertTick() {
  if (alertInterval) return;

  // Run initial evaluation
  evaluateLiveAlerts().catch(err => {
    console.warn('[Alert Tick Initial Run Error]:', err.message);
  });

  // Schedule every 60 seconds
  alertInterval = setInterval(() => {
    evaluateLiveAlerts().catch(err => {
      console.warn('[Alert Tick Error]:', err.message);
    });
  }, 60 * 1000);

  alertInterval.unref();
}

function stopAlertTick() {
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
}

module.exports = {
  startAlertTick,
  stopAlertTick
};
