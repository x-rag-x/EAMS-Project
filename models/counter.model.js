// Re-export Counter from system.model to prevent duplicate schema compilation
const { Counter } = require('./system.model');

module.exports = {
  Counter
};
